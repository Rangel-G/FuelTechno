"""
led_controller.py
==================
Controlador BLE assíncrono para a fita LEDDMX-000101 (protocolo "LED LAMP").

Projetado para rodar DENTRO do mesmo event loop asyncio do bridge.py.
É tolerante a falhas: se a fita estiver fora de alcance ou desligada,
os métodos apenas logam um aviso e retornam, sem derrubar o resto do bridge
(o OBD2 continua funcionando normalmente mesmo sem a fita conectada).

Reconexão automática: roda em background e tenta reconectar a cada 5s
sempre que perde o link com a fita.
"""

import asyncio
import logging

from bleak import BleakScanner
from bleak_retry_connector import establish_connection, BleakClientWithServiceCache

LED_DEVICE_NAME = "LEDDMX-000101"
LED_CHAR_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb"

logger = logging.getLogger("led")


def _make_power_data(power_on: bool) -> bytes:
    return bytes(
        [0x7B, 0xFF, 0x04, 0x03 if power_on else 0x02, 0xFF, 0xFF, 0xFF, 0xFF, 0xBF]
    )


def _make_color_data(r: int, g: int, b: int) -> bytes:
    return bytes([0x7B, 0xFF, 0x07, r & 0xFF, g & 0xFF, b & 0xFF, 0x00, 0xFF, 0xBF])


class LedController:
    def __init__(self):
        self.client = None
        self.char = None
        self.connected = False
        self._lock = asyncio.Lock()
        self._last_color = None

    async def start(self):
        """Inicia a tentativa de conexão em background (não bloqueia o bridge)."""
        asyncio.create_task(self._connect_loop())

    async def _connect_loop(self):
        while True:
            if not self.connected:
                await self._try_connect()
            await asyncio.sleep(5)

    async def _try_connect(self):
        try:
            logger.info("Procurando fita LED (%s)...", LED_DEVICE_NAME)
            device = await BleakScanner.find_device_by_name(LED_DEVICE_NAME, timeout=8)
            if device is None:
                logger.warning(
                    "Fita LED não encontrada (fora de alcance ou sem energia)."
                )
                return

            self.client = await establish_connection(
                BleakClientWithServiceCache,
                device,
                LED_DEVICE_NAME,
                disconnected_callback=self._on_disconnect,
            )
            self.char = self.client.services.get_characteristic(LED_CHAR_UUID)
            self.connected = True
            self._last_color = None
            logger.info("Fita LED conectada.")
        except Exception as e:
            logger.warning("Falha ao conectar na fita LED: %s", e)
            self.connected = False

    def _on_disconnect(self, client):
        logger.warning("Fita LED desconectou.")
        self.connected = False

    async def _write(self, data: bytes):
        if not self.connected or self.char is None:
            return
        async with self._lock:
            try:
                await self.client.write_gatt_char(self.char, data, response=False)
            except Exception as e:
                logger.warning("Falha ao escrever na fita LED: %s", e)
                self.connected = False

    async def power_on(self):
        await self._write(_make_power_data(True))

    async def power_off(self):
        await self._write(_make_power_data(False))

    async def set_color(self, r: int, g: int, b: int, force: bool = False):
        """
        Define a cor da fita. Por padrão, ignora chamadas repetidas com a
        mesma cor (evita floodar o BLE quando chamado a cada frame do OBD2).
        Use force=True para comandos manuais explícitos do usuário.
        """
        color = (int(r) & 0xFF, int(g) & 0xFF, int(b) & 0xFF)
        if not force and color == self._last_color:
            return
        self._last_color = color
        await self._write(_make_color_data(*color))
