"""
main.py
========
Ponto de entrada ÚNICO do FuelTechno.

É este arquivo que você compila em um .exe (veja BUILD.md). Ao dar duplo
clique no executável gerado, ele automaticamente:

  1. Sobe um servidor HTTP local servindo o frontend (index.html, app.js,
     style.css, pages/) — substitui o antigo "python -m http.server".
  2. Sobe o bridge (WebSocket + OBD-II + LED) em background — substitui
     o antigo "python bridge.py".
  3. Abre uma janela nativa (via pywebview) já carregando a interface.

Não é mais necessário abrir o CMD para nada. A conexão com o adaptador
OBD-II (porta serial) passou a ser manual: use o botão "Ligar Conexão"
na tela de Ajustes dentro da própria interface.
"""

import os
import sys
import threading
import http.server
import functools
import asyncio
import logging

import webview

import bridge  # reaproveita toda a lógica existente do bridge.py

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

HTTP_PORT = 8000


def resource_path(relative_path: str) -> str:
    """
    Resolve caminhos tanto rodando via 'python main.py' (modo desenvolvimento)
    quanto dentro do executável gerado pelo PyInstaller (--onefile), onde os
    arquivos ficam extraídos numa pasta temporária (sys._MEIPASS).
    """
    base_path = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_path, relative_path)


def start_static_server():
    """Sobe um servidor HTTP simples servindo os arquivos do frontend."""
    frontend_dir = resource_path(".")
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=frontend_dir)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", HTTP_PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True, name="static-server").start()
    logging.info(f"Frontend servido em http://127.0.0.1:{HTTP_PORT}")


def start_bridge_loop():
    """
    Sobe o bridge (WebSocket + OBD-II + LED) em uma thread própria, com seu
    próprio event loop asyncio, para não travar a janela do webview.
    """
    def runner():
        try:
            asyncio.run(bridge.main())
        except Exception:
            logging.exception("O bridge encerrou com um erro inesperado.")

    threading.Thread(target=runner, daemon=True, name="bridge-loop").start()


def main():
    start_static_server()
    start_bridge_loop()

    webview.create_window(
        "FuelTechno",
        f"http://127.0.0.1:{HTTP_PORT}/index.html",
        width=1180,
        height=640,
        resizable=True,
        confirm_close=False,
    )
    # webview.start() bloqueia a thread principal até a janela ser fechada,
    # exatamente como se fosse um app desktop nativo.
    webview.start()


if __name__ == "__main__":
    main()
