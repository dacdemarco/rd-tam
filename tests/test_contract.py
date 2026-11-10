"""Public interface: styling can change freely, these cannot."""
import os
import subprocess
import sys
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from rd_tam.app import Bridge  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "web/index.html").read_text(encoding="utf-8")
ANALYSIS = (ROOT / "web/analysis.js").read_text(encoding="utf-8")

BRIDGE = ["config", "ready", "openMedia", "pause", "resume", "cancel", "exportJob", "openAnalysis",
          "saveText", "saveImage", "saveChart", "startJobs", "downloadModel", "cancelDownload", "stateChanged", "documentsLoaded", "notified"]
FROZEN_IDS = ["tab-transcribe", "tab-analysis", "theme-toggle", "transcribe-panel", "analysis-panel",
              "analysis-root", "language-button", "language-label", "language-popover", "language-search",
              "language-options", "queue-count", "open-media", "queue", "current-name", "segment-count",
              "paper-status", "paper-language", "transcript", "transcript-position", "progress-stage",
              "progress-percent", "progress-track", "progress-fill", "speed", "eta", "pause-job", "cancel-job",
              "format-txt", "format-srt", "export-job", "toast", "analysis-keyword", "analysis-around",
              "analysis-file-count"]
CLI = ["--browser", "--self-test", "--smoke-test", "--self-test-report", "--test-audio", "--port"]


def test_bridge():
    assert [name for name in BRIDGE if not hasattr(Bridge, name)] == []


def test_dom_ids():
    assert [x for x in FROZEN_IDS if f'id="{x}"' not in HTML and f'id="{x}"' not in ANALYSIS] == []


def test_data_attributes():
    for model in ("tiny", "small", "medium"):
        assert f'data-model="{model}"' in HTML
    for action in ("png", "html"):
        assert f'data-action="{action}"' in ANALYSIS


def test_cli():
    out = subprocess.run([sys.executable, "main.py", "--help"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    assert [flag for flag in CLI if flag not in out] == []
