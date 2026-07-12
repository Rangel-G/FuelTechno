import asyncio
import json
import logging
import os  # Importante para detectar o sistema operacional
import serial
import time

from serial.tools import list_ports
from led_controller import LedController
import config

SERIAL_PORT = config.SERIAL_PORT
BAUD_RATE = config.BAUD_RATE
WS_HOST = config.WS_HOST
WS_PORT = config.WS_PORT

log_level = getattr(logging, config.LOG_LEVEL, logging.INFO)
logging.basicConfig(level=log_level, format="%(asctime)s [%(levelname)s] %(message)s")

# ==========================================
# ESTADO E CONFIGURAÇÃO DA FITA LED
# ==========================================
led = LedController()

led_auto_mode = True  # True = shift light automático por RPM
led_manual_color = (255, 0, 0)  # última cor definida manualmente pelo usuário

# RPM mais recente lido do OBD-II — atualizado pelo telemetry_sender e lido
# pelo loop dedicado do shift light (led_shift_light_loop), que roda
# independente da velocidade de resposta do adaptador OBD-II.
current_rpm = 0

# Faixa de RPM para o shift light (ajuste conforme o motor/gosto)
LED_REDLINE_RPM = config.LED_REDLINE_RPM  # a partir daqui a fita vira vermelha


# Intervalo do "pisca" do shift light quando o RPM atinge o redline (segundos)
LED_BLINK_INTERVAL = 0.15  # 150ms aceso / 150ms apagado (~3.3 piscadas/seg)


def rpm_to_shift_color(rpm: int):
    """
    Calcula a cor do shift light com base no RPM atual.

    Lê config.LED_REDLINE_RPM e config.LED_BLINK_INTERVAL_MS a cada chamada
    (nunca em cache), para respeitar mudanças feitas na tela de Ajustes sem
    precisar reiniciar o bridge.

    Abaixo do redline: cor normal, sólida.
    A partir do redline: strobe rápido alternando entre a cor de redline e
    branco puro (mais estridente/chamativo do que alternar com apagado).
    """
    if rpm < config.LED_REDLINE_RPM:
        return config.LED_COLOR_NORMAL

    intervalo_seg = max(
        0.02, config.LED_BLINK_INTERVAL_MS / 1000.0
    )  # trava mínima 20ms
    fase = int(time.time() / intervalo_seg) % 2
    return config.LED_COLOR_REDLINE if fase == 0 else (0, 0, 0)


FTDI_VID = 0x0403  # Vendor ID padrão dos chips FTDI
OBD_PROTOCOL_MAP = {
    "auto": "0",
    "iso9141": "3",
    "iso14230": "5",
    "can11-500": "6",
    "can29-500": "7",
    "can11-250": "8",
    "can29-250": "9",
}


def list_ftdi_devices():
    """
    Varre as portas seriais do sistema e retorna só os adaptadores FTDI
    conectados agora. Cada item traz a porta atual (COM/tty) e o número
    de série do chip — que é o identificador ESTÁVEL do dispositivo.
    """
    devices = []
    for p in list_ports.comports():
        if p.vid == FTDI_VID or (p.manufacturer and "FTDI" in p.manufacturer.upper()):
            devices.append(
                {
                    "port": p.device,
                    "serial_number": p.serial_number or "",
                    "description": p.description or "",
                }
            )
    return devices


def resolve_ftdi_port(serial_number: str):
    """
    Dado o número de série salvo na config, encontra a porta COM/tty ATUAL
    desse adaptador específico. Retorna None se ele não estiver conectado.
    """
    if not serial_number:
        return None
    for p in list_ports.comports():
        if p.serial_number == serial_number:
            return p.device
    return None


def list_ftdi_d2xx_devices():
    """
    Lista os adaptadores FTDI usando o driver D2XX diretamente — o mesmo
    mecanismo do FORScan. Funciona mesmo quando o chip está em modo D2XX
    puro, sem porta COM/VCP visível pelo Windows.
    """
    try:
        import ftd2xx as ftd
    except ImportError:
        logging.warning("Pacote 'ftd2xx' não instalado — rode: pip install ftd2xx")
        return []

    devices = []
    try:
        n = ftd.createDeviceInfoList()
        for i in range(n):
            info = ftd.getDeviceInfoDetail(i)
            serial_number = (
                (info.get("serial") or b"").decode(errors="ignore").strip("\x00")
            )
            description = (
                (info.get("description") or b"").decode(errors="ignore").strip("\x00")
            )
            if not serial_number:
                continue
            devices.append(
                {
                    "index": i,
                    "serial_number": serial_number,
                    "description": description,
                }
            )
    except Exception as e:
        logging.warning(f"Falha ao listar dispositivos FTDI D2XX: {e}")
    return devices


class FtdiD2xxAdapter:
    """
    Expõe uma interface parecida com serial.Serial (write, read_until,
    is_open, close) mas por baixo fala com o chip via driver D2XX da FTDI,
    identificando o dispositivo pelo NÚMERO DE SÉRIE — igual ao FORScan.
    """

    def __init__(self, serial_number: str, baudrate: int, timeout: float = 1.0):
        import ftd2xx as ftd

        self.supported_pids = set()
        self.disabled_pids = set()
        self._fail_counts = {}
        self._ftd = ftd
        self.serial_number = serial_number
        self.baudrate = baudrate
        self.timeout = timeout
        self._dev = None
        self.is_open = False
        self._open()

    def _open(self):
        self._dev = self._ftd.openEx(self.serial_number.encode())
        self._dev.setBaudRate(self.baudrate)
        self._dev.setDataCharacteristics(8, 0, 0)
        self._dev.setFlowControl(0, 0, 0)
        self._dev.setTimeouts(int(self.timeout * 1000), int(self.timeout * 1000))
        self._dev.purge()
        self.is_open = True

    def write(self, data: bytes):
        if not self.is_open or self._dev is None:
            return
        self._dev.write(data)

    def read_until(self, terminator: bytes = b">") -> bytes:
        if not self.is_open or self._dev is None:
            return b""
        buf = b""
        deadline = time.time() + max(self.timeout * 3, 1.0)
        while terminator not in buf and time.time() < deadline:
            n = self._dev.getQueueStatus()
            if n:
                buf += self._dev.read(n)
            else:
                time.sleep(0.01)
        return buf

    def _detect_supported_pids(self):
        """
        Pergunta 0100/0120/0140 pra descobrir quais PIDs a ECU realmente
        suporta, antes de começar o polling — evita ficar perguntando por
        sensores que o carro não tem em todo frame.
        """
        self.supported_pids = set()
        blocks = [("0100", 0x00), ("0120", 0x20), ("0140", 0x40)]
        for query_pid, base in blocks:
            res = self._send_cmd(query_pid)
            expected = "41" + query_pid[2:]
            data = self.parse_hex_response(res, expected, 4)
            if not data:
                break
            bitmask = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]
            for i in range(32):
                if bitmask & (1 << (31 - i)):
                    self.supported_pids.add(f"{base + i + 1:02X}")
            if not (bitmask & 0x01):
                break
        logging.info(f"[OBD] PIDs suportados: {sorted(self.supported_pids)}")

    def close(self):
        if self._dev is not None and self.is_open:
            try:
                self._dev.close()
            except Exception:
                pass
        self.is_open = False


class ELM327Bridge:
    def __init__(self, port, baudrate):
        self.supported_pids = set()
        self.disabled_pids = set()
        self._fail_counts = {}
        self.port = port
        self.baudrate = baudrate
        self.ser = None
        self.is_connected = False
        # Modo D2XX (FTDI direto, tipo FORScan): quando ativo, ignora
        # 'port' e conecta pelo número de série guardado em ftdi_serial.
        self.use_ftdi_d2xx = False
        self.ftdi_serial = ""

    def connect(self):
        try:
            if self.use_ftdi_d2xx:
                ...
            else:
                logging.info(f"Conectando ao ELM327 na porta {self.port}...")
                self.ser = serial.Serial(self.port, self.baudrate, timeout=2.0)
                self.ser.dtr = True
                self.ser.rts = True
                time.sleep(1.0)
                self.ser.reset_input_buffer()
                self.is_connected = True
                logging.info("Conexão estabelecida. Inicializando protocolo AT...")
                self._init_elm()
                self._detect_supported_pids()
                return True
        except Exception as e:
            logging.error(f"Falha ao abrir conexão: {e}")
            self.is_connected = False
            return False

    def disconnect(self):
        """Encerra a conexão manualmente (acionado pelo botão 'Desligar Conexão')."""
        try:
            if self.ser and self.ser.is_open:
                self.ser.close()
                logging.info("Conexão OBD-II encerrada manualmente pelo usuário.")
        except Exception as e:
            logging.warning(f"Erro ao fechar a conexão: {e}")
        finally:
            self.is_connected = False

    def _send_cmd(self, cmd: str) -> str:
        if not self.ser or not self.is_connected:
            return ""
        try:
            self.ser.reset_input_buffer()  # NOVO: descarta lixo/resposta atrasada
            self.ser.write(f"{cmd}\r".encode("utf-8"))
            time.sleep(0.05)
            response = self.ser.read_until(b">").decode("utf-8", errors="ignore")
            return response.replace("\r", "").replace("\n", "").replace(">", "").strip()
        except Exception as e:
            logging.error(f"Erro de comunicação no comando {cmd}: {e}")
            self.is_connected = False
            return ""

    def _init_elm(self):
        proto_code = OBD_PROTOCOL_MAP.get(config.OBD_PROTOCOL, "0")
        commands = ["ATZ", "ATE0", "ATL0", "ATS0", "ATAT1", f"ATSP{proto_code}"]
        for cmd in commands:
            res = self._send_cmd(cmd)
            logging.info(f"Enviado: {cmd} -> Resposta: {res}")
        logging.info("Aguardando sincronismo com a ECU do veículo...")
        time.sleep(1)

    def parse_hex_response(
        self, response: str, expected_prefix: str, bytes_needed: int
    ) -> list:
        """Filtra e extrai os bytes úteis da string de resposta hexadecimal."""
        # Se houver erros comuns do protocolo OBD
        if any(err in response for err in ["NODATA", "ERROR", "?", "SEARCHING"]):
            return []

        # O ELM responde com o modo alterado (Ex: Solicitação 010C responde 410C...)
        if expected_prefix in response:
            data_part = response.split(expected_prefix)[-1]
            if len(data_part) >= bytes_needed * 2:
                try:
                    return [
                        int(data_part[i : i + 2], 16)
                        for i in range(0, bytes_needed * 2, 2)
                    ]
                except ValueError:
                    return []
        return []

    def _detect_supported_pids(self):
        """
        Pergunta 0100/0120/0140 pra descobrir quais PIDs a ECU realmente
        suporta, antes de começar o polling — evita ficar perguntando por
        sensores que o carro não tem em todo frame.
        """
        self.supported_pids = set()
        blocks = [("0100", 0x00), ("0120", 0x20), ("0140", 0x40)]
        for query_pid, base in blocks:
            res = self._send_cmd(query_pid)
            expected = "41" + query_pid[2:]
            data = self.parse_hex_response(res, expected, 4)
            if not data:
                break
            bitmask = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]
            for i in range(32):
                if bitmask & (1 << (31 - i)):
                    self.supported_pids.add(f"{base + i + 1:02X}")
            if not (bitmask & 0x01):
                break
        logging.info(f"[OBD] PIDs suportados: {sorted(self.supported_pids)}")

    def query_telemetry(self) -> dict:
        payload = {
            "rpm": 0,
            "speed": 0,
            "map": -0.55,
            "ect": 20,
            "fpress": 0.0,
            "fpress_avail": False,
            "load": 0,
            "battery": 0.0,
            "fuel": 0,
            "mil_on": False,
            "dtc_count": 0,
        }

        if not self.is_connected:
            return payload

        # PID 010C - RPM (2 Bytes)
        if not self.supported_pids or "0C" in self.supported_pids:
            res_rpm = self._send_cmd("010C")
            bytes_rpm = self.parse_hex_response(res_rpm, "410C", 2)
            if bytes_rpm:
                payload["rpm"] = int(((bytes_rpm[0] * 256) + bytes_rpm[1]) / 4)

        # PID 010D - Velocidade VSS (1 Byte)
        if not self.supported_pids or "0D" in self.supported_pids:
            res_speed = self._send_cmd("010D")
            bytes_speed = self.parse_hex_response(res_speed, "410D", 1)
            if bytes_speed:
                payload["speed"] = bytes_speed[0]

        # PID 0105 - ECT Temperatura do Motor (1 Byte)
        if not self.supported_pids or "05" in self.supported_pids:
            res_ect = self._send_cmd("0105")
            bytes_ect = self.parse_hex_response(res_ect, "4105", 1)
            if bytes_ect:
                payload["ect"] = bytes_ect[0] - 40

        # PID 010B - MAP Pressão Absoluta do Coletor (1 Byte em kPa)
        if not self.supported_pids or "0B" in self.supported_pids:
            res_map = self._send_cmd("010B")
            bytes_map = self.parse_hex_response(res_map, "410B", 1)
            if bytes_map:
                kpa = bytes_map[0]
                payload["map"] = (kpa / 100.0) - 1.0

        # PID 0104 - Carga Calculada do Motor (1 Byte)
        if not self.supported_pids or "04" in self.supported_pids:
            res_load = self._send_cmd("0104")
            bytes_load = self.parse_hex_response(res_load, "4104", 1)
            if bytes_load:
                payload["load"] = int((bytes_load[0] * 100) / 255)

        # PID 010A - Pressão de Combustível
        if not self.supported_pids or "0A" in self.supported_pids:
            res_fp = self._send_cmd("010A")
            bytes_fp = self.parse_hex_response(res_fp, "410A", 1)
            if bytes_fp:
                kpa_fp = bytes_fp[0] * 3
                payload["fpress"] = kpa_fp / 100.0
            payload["fpress_avail"] = True
        else:
            payload["fpress_avail"] = False

            # PID 0142 - Tensão do Módulo de Controle / Bateria (2 Bytes em mV)
            res_volt = self._send_cmd("ATRV")
            try:
                payload["battery"] = float(res_volt.replace("V", "").strip())
            except (ValueError, AttributeError):
                pass

        # PID 0101 - Status de Monitoramento (MIL ligada + quantidade de DTCs, 4 Bytes)
        if not self.supported_pids or "01" in self.supported_pids:
            res_mon = self._send_cmd("0101")
            bytes_mon = self.parse_hex_response(res_mon, "4101", 4)
            if bytes_mon:
                byte_a = bytes_mon[0]
                payload["mil_on"] = bool(byte_a & 0x80)
                payload["dtc_count"] = byte_a & 0x7F

        # PID 012F - Nível do Tanque de Combustível
        if not self.supported_pids or "2F" in self.supported_pids:
            res_fuel = self._send_cmd("012F")
            bytes_fuel = self.parse_hex_response(res_fuel, "412F", 1)
            if bytes_fuel:
                payload["fuel"] = int((bytes_fuel[0] * 100) / 255)

        return payload


async def command_listener(websocket, bridge, bridge_ready_holder):
    """
    Escuta comandos vindos do frontend: controle da fita LED, controle
    manual da conexão OBD-II (botão "Ligar/Desligar Conexão") e leitura/
    gravação de configurações.

    Mensagens esperadas (JSON):
      {"cmd": "led_auto",  "auto": true|false}
      {"cmd": "led_color", "r": 0-255, "g": 0-255, "b": 0-255}
      {"cmd": "led_power", "on": true|false}
      {"cmd": "connect_obd"}
      {"cmd": "disconnect_obd"}
      {"cmd": "update_config", "section": "obd"|"led", ...}
      {"cmd": "get_config"}
      {"cmd": "list_ftdi_devices"}
    """
    global led_auto_mode, led_manual_color

    async for message in websocket:
        try:
            data = json.loads(message)
        except (json.JSONDecodeError, TypeError):
            continue

        cmd = data.get("cmd")

        if cmd == "led_auto":
            led_auto_mode = bool(data.get("auto", True))
            logging.info(f"[LED] Modo automático: {led_auto_mode}")

        elif cmd == "led_color":
            led_auto_mode = False
            r = int(data.get("r", 0))
            g = int(data.get("g", 0))
            b = int(data.get("b", 0))
            led_manual_color = (r, g, b)
            await led.set_color(r, g, b, force=True)
            logging.info(f"[LED] Cor manual definida: {led_manual_color}")

        elif cmd == "led_power":
            if data.get("on", True):
                await led.power_on()
                logging.info("[LED] Ligada manualmente")
            else:
                await led.power_off()
                logging.info("[LED] Desligada manualmente")

        elif cmd == "list_ftdi_devices":
            devices = list_ftdi_d2xx_devices()
            await websocket.send(
                json.dumps({"cmd": "ftdi_devices_result", "devices": devices})
            )

        elif cmd == "connect_obd":
            # Acionado pelo botão "Ligar Conexão" na tela de Ajustes.
            if bridge.is_connected:
                ok = True
                logging.info("[OBD] Conexão já estava ativa.")
            else:
                if config.OBD_CONNECTION_TYPE == "ftdi-d2xx":
                    if not config.OBD_FTDI_SERIAL:
                        logging.error(
                            "[OBD] Nenhum adaptador FTDI selecionado nos Ajustes."
                        )
                        await websocket.send(
                            json.dumps(
                                {
                                    "cmd": "obd_connection_result",
                                    "connected": False,
                                    "error": "ftdi_not_selected",
                                }
                            )
                        )
                        continue
                    bridge.use_ftdi_d2xx = True
                    bridge.ftdi_serial = config.OBD_FTDI_SERIAL
                    logging.info(
                        f"[OBD] Modo FTDI D2XX ativado, S/N {config.OBD_FTDI_SERIAL}"
                    )
                else:
                    bridge.use_ftdi_d2xx = False

                logging.info("[OBD] Conectando por comando manual da interface...")
                ok = await asyncio.to_thread(bridge.connect)

            bridge_ready_holder["ready"] = ok
            await websocket.send(
                json.dumps({"cmd": "obd_connection_result", "connected": ok})
            )

        elif cmd == "disconnect_obd":
            await asyncio.to_thread(bridge.disconnect)
            bridge_ready_holder["ready"] = False
            logging.info("[OBD] Conexão encerrada por comando manual da interface.")
            await websocket.send(
                json.dumps({"cmd": "obd_connection_result", "connected": False})
            )

        elif cmd == "get_config":
            # Envia a configuração atual para o frontend
            current_config = {
                "cmd": "current_config",
                "obd": {
                    "connection_type": config.OBD_CONNECTION_TYPE,
                    "serial_port": config.SERIAL_PORT,
                    "baud_rate": config.BAUD_RATE,
                    "protocol": config.OBD_PROTOCOL,
                    "ftdi_serial": config.OBD_FTDI_SERIAL,
                },
                "led": {
                    "device_name": config.LED_DEVICE_NAME,
                    "char_uuid": config.LED_CHAR_UUID,
                    "redline_rpm": config.LED_REDLINE_RPM,
                    "blink_interval_ms": config.LED_BLINK_INTERVAL_MS,
                    "color_normal": list(config.LED_COLOR_NORMAL),
                    "color_redline": list(config.LED_COLOR_REDLINE),
                },
            }
            await websocket.send(json.dumps(current_config))

        elif cmd == "update_config":
            section = data.get("section")
            env_updates = {}

            if section == "obd":
                conn_type = data.get("connection_type", config.OBD_CONNECTION_TYPE)
                serial_port = data.get("serial_port", config.SERIAL_PORT)
                baud_rate = str(data.get("baud_rate", config.BAUD_RATE))
                protocol = data.get("protocol", config.OBD_PROTOCOL)
                ftdi_serial = data.get("ftdi_serial", config.OBD_FTDI_SERIAL)

                config.OBD_CONNECTION_TYPE = conn_type
                config.SERIAL_PORT = serial_port
                config.BAUD_RATE = int(baud_rate)
                config.OBD_PROTOCOL = protocol
                config.OBD_FTDI_SERIAL = ftdi_serial

                bridge.port = serial_port
                bridge.baudrate = int(baud_rate)

                env_updates = {
                    "OBD_CONNECTION_TYPE": conn_type,
                    "SERIAL_PORT": serial_port,
                    "BAUD_RATE": baud_rate,
                    "OBD_PROTOCOL": protocol,
                    "OBD_FTDI_SERIAL": ftdi_serial,
                }
                logging.info(
                    f"[CONFIG] OBD atualizado: tipo={conn_type}, porta={serial_port}, "
                    f"baud={baud_rate}, proto={protocol}, ftdi_serial={ftdi_serial}"
                )

            elif section == "led":
                device_name = data.get("device_name", config.LED_DEVICE_NAME)
                char_uuid = data.get("char_uuid", config.LED_CHAR_UUID)
                redline_rpm = str(data.get("redline_rpm", config.LED_REDLINE_RPM))
                blink_ms = str(
                    data.get("blink_interval_ms", config.LED_BLINK_INTERVAL_MS)
                )
                color_normal = data.get("color_normal", list(config.LED_COLOR_NORMAL))
                color_redline = data.get(
                    "color_redline", list(config.LED_COLOR_REDLINE)
                )

                config.LED_DEVICE_NAME = device_name
                config.LED_CHAR_UUID = char_uuid
                config.LED_REDLINE_RPM = int(redline_rpm)
                config.LED_BLINK_INTERVAL_MS = int(blink_ms)
                config.LED_COLOR_NORMAL = tuple(color_normal)
                config.LED_COLOR_REDLINE = tuple(color_redline)

                env_updates = {
                    "LED_DEVICE_NAME": device_name,
                    "LED_CHAR_UUID": char_uuid,
                    "LED_REDLINE_RPM": redline_rpm,
                    "LED_BLINK_INTERVAL_MS": blink_ms,
                    "LED_COLOR_NORMAL": ",".join(str(c) for c in color_normal),
                    "LED_COLOR_REDLINE": ",".join(str(c) for c in color_redline),
                }
                logging.info(
                    f"[CONFIG] LED atualizado: nome={device_name}, redline={redline_rpm}, blink={blink_ms}ms"
                )

            if env_updates:
                config.save_to_env(env_updates)
                # Confirma pro frontend que a configuração foi salva
                await websocket.send(
                    json.dumps({"cmd": "config_saved", "section": section, "ok": True})
                )


async def telemetry_sender(websocket, bridge, bridge_ready_holder):
    """
    Loop principal: lê o OBD2 (quando conectado) e envia pro frontend.
    A conexão com a porta serial agora é 100% manual (botão "Ligar Conexão"
    na tela de Ajustes) — este loop não tenta mais reconectar sozinho.
    Também aplica a cor do shift light na fita, quando em modo automático.
    """
    while True:
        if bridge_ready_holder["ready"] and bridge.is_connected:
            telemetry = await asyncio.to_thread(bridge.query_telemetry)
            telemetry["obd_connected"] = True
            telemetry["error"] = False
        else:
            telemetry = {
                "rpm": 0,
                "speed": 0,
                "map": -1.0,
                "ect": 0,
                "fpress": 0.0,
                "fpress_avail": False,
                "load": 0,
                "battery": 0.0,
                "fuel": 0,
                "mil_on": False,
                "dtc_count": 0,
                "error": True,
                "obd_connected": False,
            }
            await asyncio.sleep(0.5)

        # --- Shift light automático baseado no RPM ---
        # Atualiza o RPM mais recente para o loop dedicado do shift light
        # (led_shift_light_loop), que roda separado do polling do OBD-II.
        global current_rpm
        current_rpm = telemetry["rpm"]

        await websocket.send(json.dumps(telemetry))
        await asyncio.sleep(0.04)  # Frequência de atualização estável (~25Hz)


async def websocket_handler(websocket):
    import websockets

    logging.info(f"Frontend conectado via WebSocket: {websocket.remote_address}")
    bridge_instance = ELM327Bridge(SERIAL_PORT, BAUD_RATE)
    # A conexão OBD-II não é mais aberta automaticamente aqui.
    # Ela só começa quando o usuário aperta "Ligar Conexão" na interface.
    bridge_ready_holder = {"ready": False}

    try:
        # Roda o envio de telemetria e a escuta de comandos em paralelo.
        # Se qualquer um encerrar (ex: cliente desconectou), o outro é cancelado.
        await asyncio.gather(
            telemetry_sender(websocket, bridge_instance, bridge_ready_holder),
            command_listener(websocket, bridge_instance, bridge_ready_holder),
        )
    except websockets.exceptions.ConnectionClosed:
        logging.info("Frontend desconectou.")
    finally:
        if bridge_instance.ser and bridge_instance.ser.is_open:
            bridge_instance.ser.close()


async def led_shift_light_loop():
    """
    Loop dedicado e independente do polling do OBD-II. Responsável apenas
    por aplicar a cor do LED (normal ou o strobe do shift light) na
    frequência exata configurada em LED_BLINK_INTERVAL_MS.

    Rodar isso separado do telemetry_sender é essencial: a leitura do
    OBD-II via serial pode levar bem mais que 40ms por ciclo (múltiplos
    comandos ELM327 sequenciais), o que deixaria o pisca irregular se ele
    dependesse do mesmo loop. Aqui o strobe fica constante, não importa a
    velocidade de resposta do adaptador OBD-II.
    """
    while True:
        if led_auto_mode:
            r, g, b = rpm_to_shift_color(current_rpm)
            await led.set_color(r, g, b)
        # Intervalo de checagem bem menor que o blink mínimo (20ms),
        # para não perder nenhuma transição de fase.
        await asyncio.sleep(0.01)


async def main():
    import websockets

    # Inicia a conexão da fita LED em background (não bloqueia o resto)
    await led.start()

    # Loop dedicado do shift light — roda uma vez só, independente de
    # quantas conexões de frontend existam.
    asyncio.create_task(led_shift_light_loop())

    async with websockets.serve(websocket_handler, WS_HOST, WS_PORT):
        logging.info(f"Servidor Bridge rodando em ws://{WS_HOST}:{WS_PORT}")
        await asyncio.Future()  # Executa permanentemente


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("Bridge encerrado pelo usuário.")
