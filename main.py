"""Desktop entry point and explicit distribution diagnostics."""
import multiprocessing


def resource_root():
    from pathlib import Path
    import sys
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def write_report(report, destination=None):
    import json
    from pathlib import Path
    import sys
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if destination:
        path = Path(destination).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(rendered + "\n", encoding="utf-8")
    if sys.stdout is not None:
        print(rendered, flush=True)


def self_test(destination=None):
    """Exercise native imports and an actual in-memory audio decode, offline."""
    import importlib
    import io
    import sys
    import wave
    checks = {}
    errors = {}
    for name in ("PySide6.QtCore", "PySide6.QtWebEngineWidgets", "faster_whisper", "av", "onnxruntime", "tokenizers", "ctranslate2", "psutil"):
        try:
            module = importlib.import_module(name)
            checks[name] = {"ok": True, "version": getattr(module, "__version__", None)}
        except Exception as exc:
            checks[name] = {"ok": False}
            errors[name] = f"{type(exc).__name__}: {exc}"
    required = ("web/index.html", "web/app.js", "web/analysis.js", "web/vendor/plotly.min.js", "assets/icon.png", "web/assets/logo-dark.png", "web/assets/logo-light.png")
    for name in required:
        path = resource_root() / name
        exists = path.is_file() and path.stat().st_size > 0
        checks[name] = {"ok": exists}
        if not exists:
            errors[name] = "Recurso ausente o vacío"
    if checks["faster_whisper"]["ok"]:
        try:
            from faster_whisper.audio import decode_audio
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as output:
                output.setnchannels(2)
                output.setsampwidth(2)
                output.setframerate(44100)
                output.writeframes(b"\x00\x00\x00\x00" * 44100)
            buffer.seek(0)
            decoded = decode_audio(buffer, sampling_rate=16000)
            valid = decoded.ndim == 1 and len(decoded) == 16000 and not decoded.any()
            checks["audio_decode"] = {"ok": bool(valid), "samples": len(decoded)}
            if not valid:
                errors["audio_decode"] = "Decodificación PCM inesperada"
        except Exception as exc:
            checks["audio_decode"] = {"ok": False}
            errors["audio_decode"] = f"{type(exc).__name__}: {exc}"
    if checks["ctranslate2"]["ok"]:
        try:
            import ctranslate2
            types = ctranslate2.get_supported_compute_types("cpu")
            checks["cpu_int8"] = {"ok": "int8" in types, "types": sorted(types)}
            if "int8" not in types:
                errors["cpu_int8"] = "La CPU no admite INT8"
        except Exception as exc:
            checks["cpu_int8"] = {"ok": False}
            errors["cpu_int8"] = str(exc)
    report = {"ok": not errors, "mode": "self-test", "platform": sys.platform, "frozen": bool(getattr(sys, "frozen", False)), "browser_bundled": (resource_root() / "browser/index.html").is_file(), "checks": checks, "errors": errors}
    write_report(report, destination)
    return 0 if report["ok"] else 1


def smoke_test(destination=None, test_audio=None):
    """Open the real Qt window, verify its local bridge, then close it."""
    import json
    import sys
    from PySide6.QtCore import QTimer
    from PySide6.QtGui import QIcon
    from PySide6.QtWidgets import QApplication
    from rd_tam.app import Window
    app = QApplication([sys.argv[0]])
    app.setOrganizationName("RD")
    app.setApplicationName("RD-TAM")
    app.setWindowIcon(QIcon(str(resource_root() / "assets/icon.png")))
    window = Window()
    completed = False
    transcription_timer = QTimer(window)

    def finish(ok, details):
        nonlocal completed
        if completed:
            return
        completed = True
        transcription_timer.stop()
        write_report({"ok": ok, "mode": "smoke-test", "details": details}, destination)
        window.bridge.manager.close()
        window.close()
        app.exit(0 if ok else 1)

    def inspect_result(value):
        try:
            state = json.loads(value)
            valid = state["ready"] == "complete" and state["plotly"] and state["analysis"] and state["native"] and state["languages"] >= 90
            if not valid or not test_audio:
                finish(bool(valid), state)
                return
            manager = window.bridge.manager
            manager.download_model("tiny")

            def inspect_transcription():
                try:
                    snapshot = manager.tick()
                    tiny = snapshot["models"]["tiny"]
                    if tiny["error"]:
                        finish(False, {"error": tiny["error"]})
                        return
                    if tiny["status"] != "ready":
                        return
                    if not snapshot["jobs"]:
                        manager.add_files([test_audio], model="tiny", language="en")
                        return
                    job = snapshot["jobs"][0]
                    if job["status"] in ("completed", "error", "cancelled"):
                        finish(job["status"] == "completed" and bool(job["segments"]), {
                            "ui": state, "status": job["status"], "error": job.get("error"),
                            "text": " ".join(segment["text"] for segment in job["segments"]),
                            "segments": job["segments"],
                        })
                except Exception as exc:
                    finish(False, {"error": f"{type(exc).__name__}: {exc}"})

            transcription_timer.timeout.connect(inspect_transcription)
            transcription_timer.start(200)
        except Exception as exc:
            finish(False, {"error": str(exc), "result": value})

    def inspect():
        window.page.runJavaScript('JSON.stringify({ready:document.readyState,plotly:!!window.Plotly,analysis:!!window.RDAnalysis,native:!!window.qt?.webChannelTransport,languages:document.querySelectorAll("#language-options button").length})', inspect_result)

    def loaded(ok):
        if not ok:
            finish(False, {"error": "No se pudo cargar la interfaz local"})
        else:
            QTimer.singleShot(1500, inspect)

    window.view.loadFinished.connect(loaded)
    QTimer.singleShot(180000 if test_audio else 20000, lambda: finish(False, {"error": "Se agotó el tiempo de verificación"}))
    window.show()
    return app.exec()


def browser_mode(port=0):
    """Keep a visible controller while the loopback web server is running."""
    from functools import partial
    from http.server import ThreadingHTTPServer
    import sys
    import threading
    from PySide6.QtCore import Qt, QTimer, QUrl
    from PySide6.QtGui import QDesktopServices, QIcon, QPixmap
    from PySide6.QtWidgets import QApplication, QDialog, QHBoxLayout, QLabel, QLineEdit, QPushButton, QVBoxLayout
    from scripts.launch_browser import StaticHandler
    directory = resource_root() / ("browser" if getattr(sys, "frozen", False) else "dist/browser")
    if not (directory / "index.html").is_file():
        raise FileNotFoundError("La edición web no está incluida en este paquete.")
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(StaticHandler, directory=str(directory)))
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.2}, daemon=True)
    thread.start()
    address = f"http://127.0.0.1:{server.server_port}/"
    app = QApplication([sys.argv[0]])
    app.setApplicationName("RD-TAM")
    app.setOrganizationName("RD")
    app.setWindowIcon(QIcon(str(resource_root() / "assets/icon.png")))
    controller = QDialog()
    controller.setWindowTitle("RD-TAM")
    controller.setMinimumWidth(440)
    controller.setStyleSheet("QDialog{background:#EFEBE1;color:#1E2A38}QLineEdit{background:#F7F4EC;color:#1E2A38;border:1px solid #7C7666;border-radius:0;padding:10px;font:13px 'Consolas','Courier New'}QPushButton{background:#2F4F73;color:#FFFFFF;border:0;border-radius:2px;padding:12px 18px;min-height:20px;font:13px 'Segoe UI'}QPushButton:focus{border:2px solid #1E2A38}")
    layout = QVBoxLayout(controller)
    layout.setContentsMargins(30, 26, 30, 26)
    layout.setSpacing(22)
    logo = QLabel()
    logo.setPixmap(QPixmap(str(resource_root() / "assets/logo-dark.png")).scaled(110, 70, Qt.KeepAspectRatio, Qt.SmoothTransformation))
    logo.setAlignment(Qt.AlignCenter)
    layout.addWidget(logo)
    location = QLineEdit(address)
    location.setReadOnly(True)
    location.setAccessibleName("Dirección local")
    layout.addWidget(location)
    buttons = QHBoxLayout()
    open_button = QPushButton("Abrir navegador")
    close_button = QPushButton("Cerrar")
    open_button.clicked.connect(lambda: QDesktopServices.openUrl(QUrl(address)))
    close_button.clicked.connect(controller.close)
    buttons.addWidget(open_button)
    buttons.addWidget(close_button)
    layout.addLayout(buttons)
    controller.show()
    QTimer.singleShot(150, lambda: QDesktopServices.openUrl(QUrl(address)))
    try:
        return app.exec()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def main():
    import argparse
    import sys
    parser = argparse.ArgumentParser(description="RD-TAM")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--browser", action="store_true", help="Abrir la edición web incluida en el navegador.")
    group.add_argument("--self-test", action="store_true", help="Verificar bibliotecas y recursos sin iniciar la interfaz.")
    group.add_argument("--smoke-test", action="store_true", help="Abrir y verificar la ventana de escritorio; cerrar automáticamente.")
    parser.add_argument("--self-test-report", help="Guardar el informe de verificación como JSON.")
    parser.add_argument("--test-audio", help="Con --smoke-test, transcribir este audio real con tiny antes de cerrar.")
    parser.add_argument("--port", type=int, default=0, help="Puerto local para --browser; 0 elige uno disponible.")
    args = parser.parse_args()
    if args.test_audio and not args.smoke_test:
        parser.error("--test-audio requiere --smoke-test")
    try:
        if args.self_test:
            return self_test(args.self_test_report)
        if args.smoke_test:
            return smoke_test(args.self_test_report, args.test_audio)
        if args.browser:
            return browser_mode(args.port)
        from rd_tam.app import run
        run()
        return 0
    except Exception as exc:
        if args.self_test or args.smoke_test:
            write_report({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, args.self_test_report)
            return 1
        raise


if __name__ == "__main__":
    multiprocessing.freeze_support()
    raise SystemExit(main())
