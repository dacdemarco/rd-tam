import hashlib
import http.server
import json
import queue
import sys
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from rd_tam import engine
from rd_tam.engine import LANGUAGES, QueueManager, format_timestamp, model_available, render_srt


class FakeQueue(queue.Queue):
    def close(self):
        pass

    def cancel_join_thread(self):
        pass


class FakeProcess:
    def __init__(self, owner, **kwargs):
        self.owner = owner
        self.alive = False
        self.suspended = False
        self.pid = 7
        self.exitcode = None
        self.kwargs = kwargs

    def start(self):
        if any(process.alive for process in self.owner.started):
            raise AssertionError("More than one transcription process started")
        self.alive = True
        self.owner.started.append(self)

    def is_alive(self):
        return self.alive

    def join(self, timeout=None):
        pass

    def finish(self, exitcode=0):
        self.alive = False
        self.exitcode = exitcode

    def terminate(self):
        self.finish(-15)

    def kill(self):
        self.finish(-9)

    def close(self):
        if self.alive:
            raise ValueError("Cannot close a live process")

    def suspend(self):
        self.suspended = True

    def resume(self):
        self.suspended = False


class FakeContext:
    def __init__(self):
        self.started = []

    def Queue(self):
        return FakeQueue()

    def Process(self, **kwargs):
        return FakeProcess(self, **kwargs)


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.media = self.root / "entrevista.mp4"
        self.media.write_bytes(b"test")
        self.context = FakeContext()
        self.now = 0.0
        self.manager = QueueManager(self.root / "data", context=self.context, clock=lambda: self.now)

    def tearDown(self):
        self.manager.close()
        self.temp.cleanup()

    def add(self, count=1):
        return self.manager.add_files([self.media] * count, model="tiny", language="es")

    def emit(self, **event):
        self.manager._events.put(event)

    def test_serial_queue_waits_for_process_exit_even_after_done(self):
        jobs = self.add(2)
        self.manager.tick()
        self.assertEqual(len(self.context.started), 1)
        self.emit(type="done")
        state = self.manager.tick()
        self.assertEqual(state["jobs"][0]["status"], "completed")
        self.assertEqual(state["jobs"][1]["status"], "pending")
        self.assertEqual(len(self.context.started), 1)
        self.context.started[0].finish()
        state = self.manager.tick()
        self.assertEqual(state["current_id"], jobs[1]["id"])
        self.assertEqual(len(self.context.started), 2)

    def test_real_timestamps_drive_progress_speed_and_eta(self):
        self.add()
        self.manager.tick()
        self.emit(type="ready", duration=120)
        self.manager.tick()
        self.now = 10
        self.emit(type="segment", segment={"start": 2, "end": 30, "text": "Hola mundo."})
        job = self.manager.tick()["jobs"][0]
        self.assertEqual(job["progress"], 25)
        self.assertEqual(job["speed"], 3)
        self.assertEqual(job["eta"], 30)
        self.assertEqual(job["segments"][0]["text"], "Hola mundo.")

    def test_pause_excludes_waiting_time_and_keeps_queue_blocked(self):
        self.add(2)
        self.manager.tick()
        self.emit(type="ready", duration=120)
        self.manager.tick()
        self.now = 10
        self.emit(type="segment", segment={"start": 0, "end": 30, "text": "Texto."})
        process = self.context.started[0]
        fake_psutil = types.SimpleNamespace(Process=lambda pid: process, NoSuchProcess=LookupError)
        with patch.dict(sys.modules, {"psutil": fake_psutil}):
            self.assertTrue(self.manager.pause())
            self.now = 90
            state = self.manager.tick()
            self.assertEqual(state["jobs"][0]["status"], "paused")
            self.assertEqual(state["jobs"][0]["speed"], 3)
            self.assertTrue(process.suspended)
            self.assertEqual(len(self.context.started), 1)
            self.assertTrue(self.manager.resume())
            self.now = 100
            self.emit(type="segment", segment={"start": 30, "end": 60, "text": "Más texto."})
            state = self.manager.tick()
            self.assertEqual(state["jobs"][0]["speed"], 3)
            self.assertEqual(state["jobs"][0]["eta"], 20)
            self.assertFalse(process.suspended)

    def test_cancel_current_advances_without_cancelling_next(self):
        jobs = self.add(2)
        self.manager.tick()
        self.assertTrue(self.manager.cancel(jobs[0]["id"]))
        state = self.manager.tick()
        self.assertEqual(state["jobs"][0]["status"], "cancelled")
        self.assertEqual(state["jobs"][1]["status"], "processing")
        self.assertFalse(self.context.started[0].alive)

    def test_cancel_pending_and_crash_continue_queue(self):
        jobs = self.add(3)
        self.manager.cancel(jobs[1]["id"])
        self.manager.tick()
        self.context.started[0].finish(exitcode=9)
        state = self.manager.tick()
        self.assertEqual([job["status"] for job in state["jobs"]], ["error", "cancelled", "processing"])
        self.assertIn("9", state["jobs"][0]["error"])
        self.assertEqual(len(self.context.started), 2)

    def test_download_has_no_fabricated_percentage(self):
        self.add()
        self.manager.tick()
        self.emit(type="stage", stage="Descargando modelo")
        self.now = 100
        job = self.manager.tick()["jobs"][0]
        self.assertIsNone(job["progress"])
        self.assertIsNone(job["speed"])
        self.assertIsNone(job["eta"])

    def test_invalid_selection_is_atomic(self):
        with self.assertRaises(ValueError):
            self.manager.add_files([self.media, self.root / "missing.wav"])
        self.assertEqual(self.manager.jobs, [])
        for model, language in [("unknown", "es"), ("tiny", "unknown")]:
            with self.assertRaises(ValueError):
                self.manager.add_files([self.media], model, language)
        self.assertEqual(len(LANGUAGES), 99)

    def test_snapshot_cannot_mutate_queue(self):
        self.add()
        state = self.manager.snapshot()
        state["jobs"][0]["status"] = "completed"
        self.assertEqual(self.manager.jobs[0]["status"], "pending")

    def test_export_uses_paired_names_and_never_overwrites(self):
        job_id = self.add()[0]["id"]
        self.manager.tick()
        self.emit(type="ready", duration=120)
        self.emit(type="segment", segment={"start": 59.9996, "end": 62.25, "text": "Texto con acentos: análisis."})
        self.emit(type="done")
        self.manager.tick()
        export_dir = self.root / "exports"
        export_dir.mkdir()
        existing = export_dir / "entrevista.txt"
        existing.write_text("Original", encoding="utf-8")
        exported = self.manager.export(job_id, export_dir)
        self.assertEqual([Path(name).name for name in exported], ["entrevista (1).txt", "entrevista (1).srt"])
        self.assertEqual(existing.read_text(encoding="utf-8"), "Original")
        self.assertIn("00:01:00,000 --> 00:01:02,250", Path(exported[1]).read_text(encoding="utf-8"))
        self.assertIn("análisis", Path(exported[0]).read_text(encoding="utf-8"))

    def test_srt_renumbers_empty_segments_and_collapses_blank_lines(self):
        text = render_srt([
            {"start": 0, "end": 0.5, "text": " "},
            {"start": 1, "end": 2, "text": "Primera\n\nsegunda"},
        ])
        self.assertEqual(text, "1\n00:00:01,000 --> 00:00:02,000\nPrimera\nsegunda\n")
        self.assertEqual(format_timestamp(3600.5), "01:00:00,500")

    def test_close_does_not_start_pending_work(self):
        self.add(2)
        self.manager.tick()
        self.manager.close()
        state = self.manager.tick()
        self.assertFalse(self.context.started[0].alive)
        self.assertEqual(state["jobs"][1]["status"], "pending")
        self.assertEqual(len(self.context.started), 1)

    def test_partial_models_are_not_treated_as_offline_ready(self):
        model_dir = self.root / "model"
        model_dir.mkdir()
        for name in ("config.json", "tokenizer.json", "model.bin"):
            (model_dir / name).write_text("data", encoding="utf-8")
        self.assertFalse(model_available(model_dir))
        (model_dir / "vocabulary.json").write_text("[]", encoding="utf-8")
        self.assertTrue(model_available(model_dir))



MODEL_BYTES = bytes(range(256)) * 4096  # 1 MiB
SMALL_FILES = {"config.json": b"{}", "tokenizer.json": b"{}", "vocabulary.txt": b"a", "model.bin": MODEL_BYTES}


class FakeHub(http.server.BaseHTTPRequestHandler):
    ranges: list = []
    fail_after = None
    corrupt = False

    def log_message(self, *args):
        pass

    def do_GET(self):
        if "/api/models/" in self.path:
            items = [{"type": "file", "path": name, "size": len(body)} for name, body in SMALL_FILES.items()]
            items[-1]["lfs"] = {"oid": hashlib.sha256(MODEL_BYTES).hexdigest()}
            items.append({"type": "file", "path": "README.md", "size": 5})
            payload = json.dumps(items).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        body = SMALL_FILES[self.path.rsplit("/", 1)[1]]
        if FakeHub.corrupt and len(body) > 10:
            body = b"x" * len(body)
        requested = self.headers.get("Range")
        start = int(requested[6:-1]) if requested else 0
        if len(body) > 10:
            FakeHub.ranges.append(start)
        self.send_response(206 if requested else 200)
        limit = FakeHub.fail_after if FakeHub.fail_after and len(body) > 10 else len(body)
        self.send_header("Content-Length", str(limit - start))  # a clean short transfer
        self.end_headers()
        self.wfile.write(body[start:limit])
        self.wfile.flush()


class ModelDownloadTests(unittest.TestCase):
    def setUp(self):
        FakeHub.ranges, FakeHub.fail_after, FakeHub.corrupt = [], None, False
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeHub)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        patcher = patch.object(engine, "HF_ENDPOINT", f"http://127.0.0.1:{self.server.server_port}")
        patcher.start()
        self.addCleanup(patcher.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.manager = QueueManager(Path(self.temp.name), context=FakeContext())
        self.model_dir = Path(self.temp.name) / "models" / "tiny"

    def tearDown(self):
        self.manager.close()
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def wait(self, *statuses):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            state = self.manager.snapshot()["models"]["tiny"]
            if state["status"] in statuses and "tiny" not in self.manager._downloads:
                return state
            time.sleep(.01)
        self.fail(f"Timed out: {state}")

    def test_download_reports_real_bytes_and_ends_ready(self):
        self.assertEqual(self.manager.snapshot()["models"]["tiny"]["status"], "missing")
        self.assertTrue(self.manager.download_model("tiny"))
        self.assertFalse(self.manager.download_model("tiny"), "a running download must not start twice")
        state = self.wait("ready")
        expected = sum(len(body) for body in SMALL_FILES.values())
        self.assertEqual((state["downloaded"], state["total"]), (expected, expected))
        self.assertTrue(model_available(self.model_dir))
        self.assertFalse(list(self.model_dir.glob("*.part")))

    def test_failed_download_resumes_where_it_stopped(self):
        FakeHub.fail_after = 400_000
        (self.model_dir / ".cache").mkdir(parents=True)
        self.manager.download_model("tiny")
        state = self.wait("missing")
        self.assertIn("reintenta", state["error"])
        self.assertFalse((self.model_dir / ".cache").exists(), "stale downloader leftovers are removed")
        kept = (self.model_dir / "model.bin.part").stat().st_size
        self.assertEqual(kept, 400_000)
        FakeHub.fail_after = None
        self.manager.download_model("tiny")
        self.wait("ready")
        self.assertEqual(FakeHub.ranges, [0, kept])
        self.assertEqual((self.model_dir / "model.bin").read_bytes(), MODEL_BYTES)

    def test_corrupt_download_is_discarded(self):
        FakeHub.corrupt = True
        self.manager.download_model("tiny")
        state = self.wait("missing")
        self.assertIn("dañado", state["error"])
        self.assertFalse((self.model_dir / "model.bin").exists())
        self.assertFalse((self.model_dir / "model.bin.part").exists())

    def test_cancel_returns_to_missing(self):
        cancelled = threading.Event()
        cancelled.set()
        self.manager._downloads["tiny"] = cancelled
        self.manager.models["tiny"]["status"] = "downloading"
        self.manager._run_download("tiny", cancelled)
        state = self.manager.snapshot()["models"]["tiny"]
        self.assertEqual(state["status"], "missing")
        self.assertIsNone(state["error"])


class WaitingFilesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.media = self.root / "a.wav"
        self.media.write_bytes(b"x")
        self.context = FakeContext()
        self.manager = QueueManager(self.root / "data", context=self.context)

    def tearDown(self):
        self.manager.close()
        self.temp.cleanup()

    def test_files_without_a_model_never_start_by_themselves(self):
        job = self.manager.add_files([self.media])[0]
        self.assertEqual(job["status"], "waiting")
        self.assertIsNone(job["model"])
        self.manager.tick()
        self.assertEqual(self.context.started, [])

    def test_start_requires_a_downloaded_model(self):
        self.manager.add_files([self.media])
        with self.assertRaisesRegex(ValueError, "Descarga"):
            self.manager.start_waiting("small")
        self.manager.models["small"]["status"] = "ready"
        self.assertEqual(self.manager.start_waiting("small", "es"), 1)
        job = self.manager.tick()["jobs"][0]
        self.assertEqual((job["status"], job["model"], job["language"]), ("processing", "small", "es"))
        self.assertEqual(len(self.context.started), 1)

    def test_waiting_file_can_be_cancelled(self):
        job = self.manager.add_files([self.media])[0]
        self.assertTrue(self.manager.cancel(job["id"]))
        self.assertEqual(self.manager.tick()["jobs"][0]["status"], "cancelled")


if __name__ == "__main__":
    unittest.main()
