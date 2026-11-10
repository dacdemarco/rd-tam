"""Small standalone launcher for the distributable browser folder."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import threading
import webbrowser


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.js': 'text/javascript'}
    def log_message(self, *args):
        pass


def main():
    root = Path(sys.executable).resolve().parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parent
    if not (root / 'index.html').exists():
        print('No se encontró index.html. Extrae la carpeta completa antes de abrir Iniciar.')
        input('Pulsa Enter para cerrar. ')
        return 1
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(root))) as server:
        server.daemon_threads = True
        url = f'http://127.0.0.1:{server.server_port}/'
        if '--self-test' in sys.argv:
            import urllib.request
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with urllib.request.urlopen(url, timeout=10) as response:
                    assert response.status == 200 and b'<html' in response.read()
                print('Launcher HTTP OK')
            finally:
                server.shutdown()
            return 0
        print(f'RD-TAM · {url}\nCierra esta ventana para terminar.\n', flush=True)
        threading.Timer(.2, lambda: webbrowser.open(url)).start()
        try:
            server.serve_forever(.25)
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
