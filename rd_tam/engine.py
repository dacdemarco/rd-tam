"""Local Whisper transcription, isolated in one cancellable worker process.

The desktop calls ``tick`` on its UI timer. Nothing in this module imports Qt,
and the sizeable inference dependencies are imported only inside the worker.
"""

from __future__ import annotations

import collections
import copy
import hashlib
import math
import multiprocessing as mp
import os
import queue
import re
import shutil
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Iterable


MODELS = {
    "tiny": {"label": "Rápido", "name": "Whisper tiny", "description": "Menor espera · precisión básica"},
    "small": {"label": "Equilibrado", "name": "Whisper small", "description": "Tiempo y precisión intermedios"},
    "medium": {"label": "Preciso", "name": "Whisper medium", "description": "Mayor precisión · mayor espera"},
}

# The original multilingual Whisper vocabulary (tiny/small/medium) contains 99
# languages. Cantonese's separate token belongs to later large-v3 models.
LANGUAGES = {
    "af": "Afrikáans", "am": "Amárico", "ar": "Árabe", "as": "Asamés",
    "az": "Azerí", "ba": "Baskir", "be": "Bielorruso", "bg": "Búlgaro",
    "bn": "Bengalí", "bo": "Tibetano", "br": "Bretón", "bs": "Bosnio",
    "ca": "Catalán", "cs": "Checo", "cy": "Galés", "da": "Danés",
    "de": "Alemán", "el": "Griego", "en": "Inglés", "es": "Español",
    "et": "Estonio", "eu": "Euskera", "fa": "Persa", "fi": "Finés",
    "fo": "Feroés", "fr": "Francés", "gl": "Gallego", "gu": "Guyaratí",
    "ha": "Hausa", "haw": "Hawaiano", "he": "Hebreo", "hi": "Hindi",
    "hr": "Croata", "ht": "Criollo haitiano", "hu": "Húngaro", "hy": "Armenio",
    "id": "Indonesio", "is": "Islandés", "it": "Italiano", "ja": "Japonés",
    "jw": "Javanés", "ka": "Georgiano", "kk": "Kazajo", "km": "Jemer",
    "kn": "Canarés", "ko": "Coreano", "la": "Latín", "lb": "Luxemburgués",
    "ln": "Lingala", "lo": "Lao", "lt": "Lituano", "lv": "Letón",
    "mg": "Malgache", "mi": "Maorí", "mk": "Macedonio", "ml": "Malayalam",
    "mn": "Mongol", "mr": "Maratí", "ms": "Malayo", "mt": "Maltés",
    "my": "Birmano", "ne": "Nepalí", "nl": "Neerlandés", "nn": "Noruego nynorsk",
    "no": "Noruego", "oc": "Occitano", "pa": "Punyabí", "pl": "Polaco",
    "ps": "Pastún", "pt": "Portugués", "ro": "Rumano", "ru": "Ruso",
    "sa": "Sánscrito", "sd": "Sindhi", "si": "Cingalés", "sk": "Eslovaco",
    "sl": "Esloveno", "sn": "Shona", "so": "Somalí", "sq": "Albanés",
    "sr": "Serbio", "su": "Sundanés", "sv": "Sueco", "sw": "Suajili",
    "ta": "Tamil", "te": "Telugu", "tg": "Tayiko", "th": "Tailandés",
    "tk": "Turcomano", "tl": "Tagalo", "tr": "Turco", "tt": "Tártaro",
    "uk": "Ucraniano", "ur": "Urdu", "uz": "Uzbeko", "vi": "Vietnamita",
    "yi": "Yidis", "yo": "Yoruba", "zh": "Chino",
}

TERMINAL_STATUSES = frozenset({"completed", "cancelled", "error"})

HF_ENDPOINT = os.environ.get("HF_ENDPOINT", "https://huggingface.co").rstrip("/")
MODEL_SIZES = {"tiny": "75 MB", "small": "484 MB", "medium": "1.5 GB"}
MODEL_FILE = re.compile(r"(config\.json|preprocessor_config\.json|model\.bin|tokenizer\.json|vocabulary\..+)")
SPEED_WINDOW_SECONDS = 5.0
DOWNLOAD_RETRY = "No se pudo descargar. Revisa la conexión y reintenta: continuará donde quedó."


def model_available(directory: Path) -> bool:
    """A local complete model never contacts the network on subsequent runs."""
    required = ("config.json", "model.bin", "tokenizer.json")
    return all((directory / name).is_file() and (directory / name).stat().st_size > 0 for name in required) and any(
        (directory / name).is_file() for name in ("vocabulary.json", "vocabulary.txt")
    )


class DownloadCancelled(Exception):
    pass


def _download_model(model: str, directory: Path, report: Any, cancelled: threading.Event) -> None:
    """Fetch a model byte by byte. Interrupted files stay as .part and resume on retry."""
    from huggingface_hub.utils import get_session  # already handles proxies and certificates

    session = get_session()
    repo = f"Systran/faster-whisper-{model}"
    listing = session.get(f"{HF_ENDPOINT}/api/models/{repo}/tree/main", timeout=30, follow_redirects=True)
    listing.raise_for_status()
    files = [item for item in listing.json() if item.get("type") == "file" and MODEL_FILE.fullmatch(item["path"])]
    if not files:
        raise ValueError("El servidor no devolvió los archivos del modelo.")
    directory.mkdir(parents=True, exist_ok=True)
    # Leftovers of the previous Hugging Face downloader can hold hundreds of MB.
    shutil.rmtree(directory / ".cache", ignore_errors=True)
    total = sum(item["size"] for item in files)
    done = sum(item["size"] for item in files if _complete(directory / item["path"], item["size"]))
    report(done, total)
    # Smallest first, so the percentage moves as soon as the transfer starts.
    for item in sorted(files, key=lambda entry: entry["size"]):
        target = directory / item["path"]
        if _complete(target, item["size"]):
            continue
        part = target.with_name(target.name + ".part")
        have = part.stat().st_size if part.exists() else 0
        if have > item["size"]:
            part.unlink()
            have = 0
        report(done + have, total)
        if have < item["size"]:
            headers = {"Accept-Encoding": "identity"}
            if have:
                headers["Range"] = f"bytes={have}-"
            url = f"{HF_ENDPOINT}/{repo}/resolve/main/{item['path']}"
            with session.stream("GET", url, headers=headers, timeout=30, follow_redirects=True) as response:
                response.raise_for_status()
                if response.status_code != 206:  # the server ignored Range: start over
                    have = 0
                with part.open("ab" if have else "wb") as handle:
                    for chunk in response.iter_bytes(1024 * 256):
                        if cancelled.is_set():
                            raise DownloadCancelled
                        handle.write(chunk)
                        have += len(chunk)
                        report(done + have, total)
        if have != item["size"]:
            raise ConnectionError("Transferencia incompleta")  # keep the .part: retry resumes it
        expected = (item.get("lfs") or {}).get("oid")
        if expected and _sha256(part, cancelled, report) != expected:
            part.unlink(missing_ok=True)
            raise ValueError("El archivo descargado llegó dañado. Vuelve a intentarlo.")
        os.replace(part, target)
        done += item["size"]
        report(done, total)
    if not model_available(directory):
        raise ValueError("El modelo descargado está incompleto.")


def _complete(path: Path, size: int) -> bool:
    return path.is_file() and path.stat().st_size == size


def _sha256(path: Path, cancelled: threading.Event, report: Any) -> str:
    report(verifying=True)
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            if cancelled.is_set():
                raise DownloadCancelled
            digest.update(chunk)
    report(verifying=False)
    return digest.hexdigest()


def _transcribe_worker(job: dict[str, Any], data_dir: str, events: Any) -> None:
    """Spawn target. The queue carries only small JSON-compatible messages."""
    def emit(kind: str, **payload: Any) -> None:
        events.put({"type": kind, **payload})

    try:
        # Keep Hugging Face's incidental cache within the portable data folder.
        os.environ["HF_HOME"] = str(Path(data_dir) / "cache")
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
        os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
        emit("stage", stage="Preparando motor")
        from faster_whisper import WhisperModel
        from faster_whisper.audio import decode_audio

        model_dir = Path(data_dir) / "models" / job["model"]
        if not model_available(model_dir):
            raise ValueError("El modelo no está descargado. Descárgalo desde su casilla.")
        emit("stage", stage="Cargando modelo")
        model = WhisperModel(
            str(model_dir), device="cpu", compute_type="int8",
            cpu_threads=max(1, min(8, (os.cpu_count() or 2) - 1)),
            num_workers=1, local_files_only=True,
        )
        emit("stage", stage="Leyendo audio")
        audio = decode_audio(job["path"], sampling_rate=16000)
        duration = len(audio) / 16000.0
        if duration <= 0:
            raise ValueError("El archivo no contiene audio decodificable.")
        emit("ready", duration=duration)
        segments, info = model.transcribe(
            audio, language=job["language"], task="transcribe",
            beam_size=1 if job["model"] == "tiny" else 5,
            vad_filter=True, condition_on_previous_text=True,
        )
        emit("language", language=info.language)
        for segment in segments:
            text = segment.text.strip()
            # Empty blocks do not belong in subtitle exports, but advance time.
            start = max(0.0, min(duration, float(segment.start)))
            end = max(start, min(duration, float(segment.end)))
            emit("segment", segment={"start": start, "end": end, "text": text})
        emit("done")
    except Exception as exc:
        emit("error", error=_user_error(exc))


def _user_error(exc: Exception) -> str:
    """Keep recovery information; avoid dumping a Python traceback in the UI."""
    kind = type(exc).__name__
    detail = str(exc).strip()[:500]
    if isinstance(exc, MemoryError) or "out of memory" in detail.lower():
        return "Memoria insuficiente. Prueba el modelo Rápido o un archivo más corto."
    if isinstance(exc, ImportError):
        return "El motor Whisper no está disponible en esta instalación. " + detail
    if any(term in kind.lower() for term in ("invaliddata", "decoder", "ffmpeg")):
        return "No se pudo leer el audio de este archivo. " + detail
    if any(term in (kind + " " + detail).lower() for term in ("connect", "timeout", "network", "offline", "localentrynotfound")):
        return "No se pudo descargar el modelo. Revisa la conexión o copia el modelo a la carpeta data/models. " + detail
    return detail or kind


def format_timestamp(seconds: float) -> str:
    """SubRip timestamp, with millisecond rounding carried into the next unit."""
    if not math.isfinite(seconds):
        raise ValueError("Tiempo no válido")
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def render_txt(segments: Iterable[dict[str, Any]]) -> str:
    lines = [str(segment["text"]).strip() for segment in segments if str(segment["text"]).strip()]
    return "\n".join(lines) + ("\n" if lines else "")


def render_srt(segments: Iterable[dict[str, Any]]) -> str:
    blocks = []
    for segment in segments:
        # Blank subtitle lines separate cues, so collapse internal blank lines.
        text = "\n".join(line.strip() for line in str(segment["text"]).splitlines() if line.strip())
        if not text:
            continue
        start = max(0.0, float(segment["start"]))
        end = max(start + 0.001, float(segment["end"]))
        blocks.append(f"{len(blocks) + 1}\n{format_timestamp(start)} --> {format_timestamp(end)}\n{text}\n")
    return "\n".join(blocks)


class QueueManager:
    """Serial transcription queue; call from one thread (the desktop UI thread).

    ``context`` and ``clock`` are injection points for deterministic lifecycle
    tests. They are not required by desktop callers.
    """

    def __init__(self, data_dir: Path, *, context: Any = None, clock: Any = time.monotonic):
        self.data_dir = Path(data_dir).resolve()
        (self.data_dir / "models").mkdir(parents=True, exist_ok=True)
        self.jobs: list[dict[str, Any]] = []
        self.current_id: str | None = None
        self._context = context or mp.get_context("spawn")
        self._clock = clock
        self._process: Any = None
        self._events: Any = None
        self._phase_started: float | None = None
        self._paused_at: float | None = None
        self._paused_seconds = 0.0
        self._processed_seconds = 0.0
        self._closed = False
        self._downloads: dict[str, threading.Event] = {}
        self.models = {
            name: {"status": "ready" if model_available(self.data_dir / "models" / name) else "missing",
                   "size": MODEL_SIZES[name], "downloaded": 0, "total": None, "speed": None, "eta": None, "error": None}
            for name in MODELS
        }

    def download_model(self, model: str) -> bool:
        """Start one background download; its progress is reported in ``snapshot()['models']``."""
        if model not in MODELS:
            raise ValueError("Selecciona un modelo válido.")
        if self._closed or self.models[model]["status"] != "missing":
            return False
        cancelled = threading.Event()
        self._downloads[model] = cancelled
        self.models[model].update(status="downloading", downloaded=0, total=None, speed=None, eta=None, error=None)
        threading.Thread(target=self._run_download, args=(model, cancelled), name=f"RD-model-{model}", daemon=True).start()
        return True

    def cancel_download(self, model: str) -> bool:
        cancelled = self._downloads.get(model)
        if cancelled is None:
            return False
        cancelled.set()
        return True

    def _run_download(self, model: str, cancelled: threading.Event) -> None:
        state = self.models[model]
        window: collections.deque[tuple[float, int]] = collections.deque()

        def report(downloaded: int | None = None, total: int | None = None, verifying: bool | None = None) -> None:
            if verifying is not None:
                state.update(status="verifying" if verifying else "downloading", speed=None, eta=None)
                return
            now = self._clock()
            window.append((now, downloaded))
            while len(window) > 2 and now - window[0][0] > SPEED_WINDOW_SECONDS:
                window.popleft()
            elapsed = now - window[0][0]
            speed = (downloaded - window[0][1]) / elapsed if elapsed >= 1 else state["speed"]
            state.update(downloaded=downloaded, total=total, speed=speed,
                         eta=(total - downloaded) / speed if speed else None)

        try:
            _download_model(model, self.data_dir / "models" / model, report, cancelled)
            state.update(status="ready", speed=None, eta=None, error=None)
        except DownloadCancelled:
            state.update(status="missing", speed=None, eta=None)
        except OSError as exc:
            if isinstance(exc, ConnectionError):
                state.update(status="missing", speed=None, eta=None, error=DOWNLOAD_RETRY)
            else:
                state.update(status="missing", speed=None, eta=None, error=f"No se pudo guardar el modelo: {exc.strerror or exc}")
        except ValueError as exc:
            state.update(status="missing", speed=None, eta=None, error=str(exc))
        except Exception as exc:
            if sys.stderr:
                print(f"Model download failed: {type(exc).__name__}: {exc}", file=sys.stderr)
            state.update(status="missing", speed=None, eta=None, error=DOWNLOAD_RETRY)
        finally:
            self._downloads.pop(model, None)

    def start_waiting(self, model: str, language: str | None = None) -> int:
        """Assign the chosen model and language to the files waiting in the queue."""
        if model not in MODELS:
            raise ValueError("Selecciona un modelo válido.")
        if self.models[model]["status"] != "ready":
            raise ValueError("Descarga ese modelo antes de transcribir.")
        language = self._language(language)
        waiting = [job for job in self.jobs if job["status"] == "waiting"]
        for job in waiting:
            job.update(model=model, language=language, status="pending", stage="Pendiente")
        return len(waiting)

    @staticmethod
    def _language(language: str | None) -> str | None:
        language = None if language in (None, "", "auto") else language
        if language is not None and language not in LANGUAGES:
            raise ValueError("Selecciona un idioma válido.")
        return language

    def add_files(self, paths: Iterable[str | Path], model: str | None = None, language: str | None = None) -> list[dict[str, Any]]:
        """Without a model the files wait; nothing starts until ``start_waiting``."""
        if self._closed:
            raise RuntimeError("La cola está cerrada.")
        model = model or None
        if model is not None and model not in MODELS:
            raise ValueError("Selecciona un modelo válido.")
        language = self._language(language)
        # Validate the whole batch first, avoiding partially-enqueued selection.
        resolved = [Path(path).expanduser().resolve() for path in paths]
        for path in resolved:
            if not path.is_file():
                raise ValueError(f"No se encontró el archivo: {path.name}")
        added = []
        for path in resolved:
            job = {
                "id": uuid.uuid4().hex, "name": path.name, "path": str(path),
                "model": model, "language": language, "detected_language": None,
                "status": "pending" if model else "waiting",
                "stage": "Pendiente" if model else "Esperando modelo", "progress": 0,
                "speed": None, "eta": None, "duration": None,
                "segments": [], "error": None,
            }
            self.jobs.append(job)
            added.append(copy.deepcopy(job))
        return added

    def _job(self, job_id: str | None = None) -> dict[str, Any] | None:
        target = self.current_id if job_id is None else job_id
        return next((job for job in self.jobs if job["id"] == target), None)

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        job = self._job(job_id)
        return copy.deepcopy(job) if job else None

    def snapshot(self) -> dict[str, Any]:
        return {"jobs": copy.deepcopy(self.jobs), "current_id": self.current_id, "models": copy.deepcopy(self.models)}

    def tick(self) -> dict[str, Any]:
        if self._closed:
            return self.snapshot()
        self._drain_events()
        self._reap_finished()
        if self._process is None:
            next_job = next((job for job in self.jobs if job["status"] == "pending"), None)
            if next_job:
                self._start(next_job)
        self._update_metrics()
        return self.snapshot()

    def _start(self, job: dict[str, Any]) -> None:
        self.current_id = job["id"]
        self._phase_started = None
        self._paused_at = None
        self._paused_seconds = 0.0
        self._processed_seconds = 0.0
        job.update(status="processing", stage="Preparando motor", progress=None)
        self._events = self._context.Queue()
        self._process = self._context.Process(
            target=_transcribe_worker,
            args=(copy.deepcopy(job), str(self.data_dir), self._events),
            name="RD-Whisper", daemon=True,
        )
        try:
            self._process.start()
        except Exception as exc:
            job.update(status="error", stage="Error", error=_user_error(exc))
            self._release()

    def _drain_events(self) -> None:
        if self._events is None:
            return
        job = self._job()
        while True:
            try:
                event = self._events.get_nowait()
            except (queue.Empty, EOFError, OSError, ValueError):
                break
            if job is None or job["status"] in TERMINAL_STATUSES:
                continue
            kind = event.get("type")
            if kind == "stage":
                job["stage"] = event["stage"]
            elif kind == "ready":
                job.update(duration=float(event["duration"]), progress=0, stage="Transcribiendo")
                self._phase_started = self._clock()
                self._paused_seconds = 0.0
                # A ready message may already be in the pipe at pause time.
                if job["status"] == "paused":
                    self._paused_at = self._phase_started
            elif kind == "language":
                job["detected_language"] = event["language"]
            elif kind == "segment":
                segment = event["segment"]
                self._processed_seconds = max(self._processed_seconds, float(segment["end"]))
                if segment["text"].strip():
                    job["segments"].append(segment)
                if job["duration"]:
                    job["progress"] = min(99.9, 100 * self._processed_seconds / job["duration"])
            elif kind == "done":
                self._update_metrics()
                job.update(status="completed", stage="Completado", progress=100, eta=0)
            elif kind == "error":
                job.update(status="error", stage="Error", error=event["error"], eta=None, speed=None)

    def _reap_finished(self) -> None:
        if self._process is None or self._process.is_alive():
            return
        # On normal exit multiprocessing flushes the feeder before exiting.
        self._drain_events()
        self._process.join(timeout=0)
        job = self._job()
        if job and job["status"] not in TERMINAL_STATUSES:
            job.update(
                status="error", stage="Error", speed=None, eta=None,
                error=f"El motor terminó inesperadamente (código {self._process.exitcode}).",
            )
        self._release()

    def _release(self) -> None:
        if self._events is not None:
            self._events.close()
            self._events.cancel_join_thread()
        if self._process is not None:
            try:
                self._process.close()
            except (ValueError, AttributeError):
                pass
        self._events = None
        self._process = None
        self.current_id = None
        self._phase_started = None
        self._paused_at = None

    def _update_metrics(self) -> None:
        job = self._job()
        if job is None or job["status"] not in {"processing", "paused"} or self._phase_started is None:
            return
        now = self._paused_at if self._paused_at is not None else self._clock()
        elapsed = max(0.0, now - self._phase_started - self._paused_seconds)
        if self._processed_seconds > 0 and elapsed > 0:
            speed = self._processed_seconds / elapsed
            job["speed"] = round(speed, 3)
            job["eta"] = max(0.0, (job["duration"] - self._processed_seconds) / speed) if job["duration"] else None

    def pause(self, job_id: str | None = None) -> bool:
        self._drain_events()
        job = self._job(job_id)
        if not job or job["id"] != self.current_id or job["status"] != "processing":
            return False
        if self._process is None or not self._process.is_alive():
            self._reap_finished()
            return False
        import psutil
        try:
            psutil.Process(self._process.pid).suspend()
        except psutil.NoSuchProcess:
            self._reap_finished()
            return False
        self._paused_at = self._clock()
        job["status"] = "paused"
        self._update_metrics()
        return True

    def resume(self, job_id: str | None = None) -> bool:
        job = self._job(job_id)
        if not job or job["id"] != self.current_id or job["status"] != "paused":
            return False
        import psutil
        try:
            psutil.Process(self._process.pid).resume()
        except psutil.NoSuchProcess:
            self._reap_finished()
            return False
        if self._paused_at is not None:
            self._paused_seconds += self._clock() - self._paused_at
        self._paused_at = None
        job["status"] = "processing"
        return True

    def cancel(self, job_id: str | None = None) -> bool:
        job = self._job(job_id)
        if not job or job["status"] in TERMINAL_STATUSES:
            return False
        if job["id"] == self.current_id:
            self._drain_events()
            if job["status"] in TERMINAL_STATUSES:
                return False
            if self._process is not None and self._process.is_alive():
                # terminate/kill work on suspended processes on Windows and POSIX.
                self._process.terminate()
                self._process.join(timeout=0.25)
                if self._process.is_alive():
                    self._process.kill()
                    self._process.join(timeout=0.25)
            job.update(status="cancelled", stage="Cancelado", eta=None, speed=None)
            # Never start another worker until this one is confirmed dead.
            if self._process is None or not self._process.is_alive():
                self._release()
        else:
            job.update(status="cancelled", stage="Cancelado", eta=None, speed=None)
        return True

    def export(self, job_id: str, directory: str | Path, formats: Iterable[str] = ("txt", "srt")) -> list[str]:
        job = self._job(job_id)
        if not job:
            raise ValueError("No se encontró la transcripción.")
        chosen = list(dict.fromkeys(formats))
        if not chosen or any(fmt not in {"txt", "srt"} for fmt in chosen):
            raise ValueError("Selecciona TXT, SRT o ambos.")
        if not job["segments"] and job["status"] != "completed":
            raise ValueError("La transcripción todavía no contiene texto.")
        destination = Path(directory).expanduser().resolve()
        destination.mkdir(parents=True, exist_ok=True)
        stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", Path(job["name"]).stem).strip(". ") or "transcripcion"
        # Choose one shared suffix so paired TXT/SRT names always match.
        suffix = 0
        while any((destination / f"{stem}{f' ({suffix})' if suffix else ''}.{fmt}").exists() for fmt in chosen):
            suffix += 1
        basename = stem + (f" ({suffix})" if suffix else "")
        written = []
        try:
            for fmt in chosen:
                path = destination / f"{basename}.{fmt}"
                with path.open("x", encoding="utf-8", newline="\n") as handle:
                    written.append(str(path))
                    handle.write(render_txt(job["segments"]) if fmt == "txt" else render_srt(job["segments"]))
        except Exception:
            # Only remove files created by this failed export, never old files.
            for name in written:
                Path(name).unlink(missing_ok=True)
            raise
        return written

    def close(self) -> None:
        """Stop the worker before the desktop closes; never advance pending jobs."""
        self._closed = True
        for cancelled in list(self._downloads.values()):
            cancelled.set()
        if self.current_id:
            self.cancel(self.current_id)
        if self._process is not None and self._process.is_alive():
            self._process.kill()
            self._process.join(timeout=1)
        if self._process is None or not self._process.is_alive():
            self._release()
