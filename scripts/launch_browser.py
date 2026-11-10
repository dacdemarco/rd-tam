"""Serve the static browser edition on loopback; media never goes to this server."""
from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import webbrowser


class StaticHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm", ".mjs": "text/javascript", ".js": "text/javascript"}

    def log_message(self, format: str, *args) -> None:
        pass

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def serve_site(directory: Path, *, open_browser: bool = True, port: int = 0) -> None:
    directory = directory.resolve()
    if not (directory / "index.html").is_file():
        raise FileNotFoundError(f"No se encontró index.html en {directory}.")
    handler = partial(StaticHandler, directory=str(directory))
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    server.daemon_threads = True
    address = f"http://127.0.0.1:{server.server_port}/"
    print(f"RD-TAM: {address}\nCierra esta ventana o pulsa Ctrl+C para detener el servidor.", flush=True)
    if open_browser:
        timer = threading.Timer(0.25, lambda: webbrowser.open(address))
        timer.daemon = True
        timer.start()
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main() -> None:
    here = Path(__file__).resolve().parent
    default = here if (here / "index.html").is_file() else here.parent / "dist" / "browser"
    parser = argparse.ArgumentParser(description="Abre RD-TAM en el navegador mediante un servidor local.")
    parser.add_argument("--directory", type=Path, default=default)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()
    serve_site(args.directory, open_browser=not args.no_open, port=args.port)


if __name__ == "__main__":
    main()
