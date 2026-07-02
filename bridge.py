import asyncio
import json
import logging
import os  # Importante para detectar o sistema operacional
import serial
import time

from led_controller import LedController
import config

SERIAL_PORT = config.SERIAL_PORT
BAUD_RATE = config.BAUD_RATE
WS_HOST = config.WS_HOST
WS_PORT = config.WS_PORT

log_level = getattr(logging, config.LOG_LEVEL, logging.INFO)
logging.basicConfig(
    level=log_level, format="%(asctime)s [%(levelname)s] %(message)s"
)

# ==========================================
# ESTADO E CONFIGURAÇÃO DA FITA LED
# ==========================================
led = LedController()

led_auto_mode = True  # True = shift light automático por RPM
led_manual_color = (255, 0, 0)  # última cor definida manualmente pelo usuário

# Faixa de RPM para o shift light (ajuste conforme o motor/gosto)
LED_REDLINE_RPM = config.LED_REDLINE_RPM  # a partir daqui a fita vira vermelha


def rpm_to_shift_color(rpm: int):
    """
    Calcula a cor do shift light com base no RPM atual:
    - Cor normal (ex: Azul) até (excluindo) LED_REDLINE_RPM
    - Cor redline (ex: Vermelho) a partir de LED_REDLINE_RPM (hora de trocar de marcha)
    """
    if rpm >= LED_REDLINE_RPM:
        return config.LED_COLOR_REDLINE
    return config.LED_COLOR_NORMAL


class ELM327Bridge:
    def __init__(self, port, baudrate):
        self.port = port
        self.baudrate = baudrate
        self.ser = None
        self.is_connected = False

    def connect(self):
        try:
            logging.info(f"Conectando ao ELM327 na porta {self.port}...")
            self.ser = serial.Serial(self.port, self.baudrate, timeout=1.0)
            self.is_connected = True
            logging.info("Conexão serial estabelecida. Inicializando protocolo AT...")
            self._init_elm()
            return True
        except Exception as e:
            logging.error(f"Falha ao abrir a porta serial: {e}")
            self.is_connected = False
            return False

    def _send_cmd(self, cmd: str) -> str:
        if not self.ser or not self.is_connected:
            return ""
        try:
            self.ser.write(f"{cmd}\r".encode("utf-8"))
            time.sleep(0.05)  # Pequeno delay para processamento do clone ELM
            response = self.ser.read_until(b">").decode("utf-8", errors="ignore")
            # Limpa retornos de carro, quebras de linha e o prompt '>'
            return response.replace("\r", "").replace("\n", "").replace(">", "").strip()
        except Exception as e:
            logging.error(f"Erro de comunicação no comando {cmd}: {e}")
            self.is_connected = False
            return ""

    def _init_elm(self):
        commands = [
            "ATZ",  # Reset do dispositivo
            "ATE0",  # Eco desligado (Echo Off)
            "ATL0",  # Linefeeds desligados
            "ATS0",  # Espaços removidos das respostas para facilitar o parse
            "ATSP0",  # Auto-detectar protocolo OBD-II do veículo
        ]
        for cmd in commands:
            res = self._send_cmd(cmd)
            logging.info(f"Enviado: {cmd} -> Resposta: {res}")

        # Força uma leitura inicial para validar o protocolo do carro
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

    def query_telemetry(self) -> dict:
        payload = {
            "rpm": 0,
            "speed": 0,
            "map": -0.55,
            "ect": 20,
            "fpress": 0.0,
            "fpress_avail": False,
            "load": 0,
            "battery": 12.0,
            "mil_on": False,
            "dtc_count": 0,
        }

        if not self.is_connected:
            return payload

        # PID 010C - RPM (2 Bytes)
        res_rpm = self._send_cmd("010C")
        bytes_rpm = self.parse_hex_response(res_rpm, "410C", 2)
        if bytes_rpm:
            payload["rpm"] = int(((bytes_rpm[0] * 256) + bytes_rpm[1]) / 4)

        # PID 010D - Velocidade VSS (1 Byte)
        res_speed = self._send_cmd("010D")
        bytes_speed = self.parse_hex_response(res_speed, "410D", 1)
        if bytes_speed:
            payload["speed"] = bytes_speed[0]

        # PID 0105 - ECT Temperatura do Motor (1 Byte)
        res_ect = self._send_cmd("0105")
        bytes_ect = self.parse_hex_response(res_ect, "4105", 1)
        if bytes_ect:
            payload["ect"] = bytes_ect[0] - 40

        # PID 010B - MAP Pressão Absoluta do Coletor (1 Byte em kPa)
        res_map = self._send_cmd("010B")
        bytes_map = self.parse_hex_response(res_map, "410B", 1)
        if bytes_map:
            kpa = bytes_map[0]
            # Converte de Absoluto kPa para BAR relativo (Manômetro FuelTech padrão)
            # Ex: 100 kPa absoluto = 0 BAR relativo atmosférico. 200 kPa = 1 BAR de Turbo.
            payload["map"] = (kpa / 100.0) - 1.0

        # PID 0104 - Carga Calculada do Motor (1 Byte)
        res_load = self._send_cmd("0104")
        bytes_load = self.parse_hex_response(res_load, "4104", 1)
        if bytes_load:
            payload["load"] = int((bytes_load[0] * 100) / 255)

        # PID 010A - Pressão de Combustível (Muitos carros de rua não possuem esse sensor)
        res_fp = self._send_cmd("010A")
        bytes_fp = self.parse_hex_response(res_fp, "410A", 1)
        if bytes_fp:
            kpa_fp = bytes_fp[0] * 3
            payload["fpress"] = kpa_fp / 100.0
            payload["fpress_avail"] = True
        else:
            payload["fpress_avail"] = False

        # PID 0142 - Tensão do Módulo de Controle / Bateria (2 Bytes em mV)
        res_volt = self._send_cmd("0142")
        bytes_volt = self.parse_hex_response(res_volt, "4142", 2)
        if bytes_volt:
            payload["battery"] = ((bytes_volt[0] * 256) + bytes_volt[1]) / 1000.0

        # PID 0101 - Status de Monitoramento (MIL ligada + quantidade de DTCs, 4 Bytes)
        res_mon = self._send_cmd("0101")
        bytes_mon = self.parse_hex_response(res_mon, "4101", 4)
        if bytes_mon:
            byte_a = bytes_mon[0]
            payload["mil_on"] = bool(byte_a & 0x80)
            payload["dtc_count"] = byte_a & 0x7F

        return payload


async def led_command_listener(websocket):
    """
    Escuta comandos vindos do frontend para controlar a fita LED
    manualmente. Roda em paralelo ao envio de telemetria.

    Mensagens esperadas (JSON):
      {"cmd": "led_auto",  "auto": true|false}
      {"cmd": "led_color", "r": 0-255, "g": 0-255, "b": 0-255}
      {"cmd": "led_power", "on": true|false}
      {"cmd": "update_config", "section": "obd"|"led", ...}
      {"cmd": "get_config"}
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

        elif cmd == "get_config":
            # Envia a configuração atual para o frontend
            current_config = {
                "cmd": "current_config",
                "obd": {
                    "connection_type": config.OBD_CONNECTION_TYPE,
                    "serial_port": config.SERIAL_PORT,
                    "baud_rate": config.BAUD_RATE,
                    "protocol": config.OBD_PROTOCOL,
                },
                "led": {
                    "device_name": config.LED_DEVICE_NAME,
                    "char_uuid": config.LED_CHAR_UUID,
                    "redline_rpm": config.LED_REDLINE_RPM,
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

                config.OBD_CONNECTION_TYPE = conn_type
                config.SERIAL_PORT = serial_port
                config.BAUD_RATE = int(baud_rate)
                config.OBD_PROTOCOL = protocol

                env_updates = {
                    "OBD_CONNECTION_TYPE": conn_type,
                    "SERIAL_PORT": serial_port,
                    "BAUD_RATE": baud_rate,
                    "OBD_PROTOCOL": protocol,
                }
                logging.info(f"[CONFIG] OBD atualizado: tipo={conn_type}, porta={serial_port}, baud={baud_rate}, proto={protocol}")

            elif section == "led":
                device_name = data.get("device_name", config.LED_DEVICE_NAME)
                char_uuid = data.get("char_uuid", config.LED_CHAR_UUID)
                redline_rpm = str(data.get("redline_rpm", config.LED_REDLINE_RPM))
                color_normal = data.get("color_normal", list(config.LED_COLOR_NORMAL))
                color_redline = data.get("color_redline", list(config.LED_COLOR_REDLINE))

                config.LED_DEVICE_NAME = device_name
                config.LED_CHAR_UUID = char_uuid
                config.LED_REDLINE_RPM = int(redline_rpm)
                config.LED_COLOR_NORMAL = tuple(color_normal)
                config.LED_COLOR_REDLINE = tuple(color_redline)

                env_updates = {
                    "LED_DEVICE_NAME": device_name,
                    "LED_CHAR_UUID": char_uuid,
                    "LED_REDLINE_RPM": redline_rpm,
                    "LED_COLOR_NORMAL": ",".join(str(c) for c in color_normal),
                    "LED_COLOR_REDLINE": ",".join(str(c) for c in color_redline),
                }
                logging.info(f"[CONFIG] LED atualizado: nome={device_name}, redline={redline_rpm}")

            if env_updates:
                config.save_to_env(env_updates)
                # Confirma pro frontend que a configuração foi salva
                await websocket.send(json.dumps({"cmd": "config_saved", "section": section, "ok": True}))


async def telemetry_sender(websocket, bridge, bridge_ready_holder):
    """
    Loop principal: lê o OBD2 (ou fallback) e envia pro frontend.
    Também aplica a cor do shift light na fita, quando em modo automático.
    """
    while True:
        if bridge_ready_holder["ready"] and bridge.is_connected:
            telemetry = await asyncio.to_thread(bridge.query_telemetry)
        else:
            if bridge_ready_holder["ready"]:
                logging.warning(
                    "Conexão perdida com o ELM327. Tentando reestabelecer..."
                )
                bridge_ready_holder["ready"] = bridge.connect()

            telemetry = {
                "rpm": 0,
                "speed": 0,
                "map": -1.0,
                "ect": 0,
                "fpress": 0.0,
                "fpress_avail": False,
                "load": 0,
                "battery": 0.0,
                "mil_on": False,
                "dtc_count": 0,
                "error": True,
            }
            await asyncio.sleep(1.0)

        # --- Shift light automático baseado no RPM ---
        if led_auto_mode:
            r, g, b = rpm_to_shift_color(telemetry["rpm"])
            await led.set_color(r, g, b)

        await websocket.send(json.dumps(telemetry))
        await asyncio.sleep(0.04)  # Frequência de atualização estável (~25Hz)


async def websocket_handler(websocket):
    import websockets

    logging.info(f"Frontend conectado via WebSocket: {websocket.remote_address}")
    bridge = ELM327Bridge(SERIAL_PORT, BAUD_RATE)
    bridge_ready_holder = {"ready": bridge.connect()}

    try:
        # Roda o envio de telemetria e a escuta de comandos LED em paralelo.
        # Se qualquer um encerrar (ex: cliente desconectou), o outro é cancelado.
        await asyncio.gather(
            telemetry_sender(websocket, bridge, bridge_ready_holder),
            led_command_listener(websocket),
        )
    except websockets.exceptions.ConnectionClosed:
        logging.info("Frontend desconectou.")
    finally:
        if bridge.ser and bridge.ser.is_open:
            bridge.ser.close()


async def main():
    import websockets

    # Inicia a conexão da fita LED em background (não bloqueia o resto)
    await led.start()

    async with websockets.serve(websocket_handler, WS_HOST, WS_PORT):
        logging.info(f"Servidor Bridge rodando em ws://{WS_HOST}:{WS_PORT}")
        await asyncio.Future()  # Executa permanentemente


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("Bridge encerrado pelo usuário.")
