"""Exported charts and the browser-mode dialog use the day palette."""
import os
import re
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from rd_tam.app import chart_document  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def test_default_background():
    html = chart_document({"data": []})
    assert "background:#EFEBE1" in html
    assert "#f2f1e9" not in html


def test_background_follows_figure():
    assert "background:#141A1E" in chart_document({"data": [], "layout": {"paper_bgcolor": "#141A1E"}})


def test_non_hex_background_falls_back():
    assert "background:#EFEBE1" in chart_document({"data": [], "layout": {"paper_bgcolor": "red"}})


def test_browser_dialog_palette():
    sheet = re.search(r'setStyleSheet\("([^"]*)"\)', (ROOT / "main.py").read_text(encoding="utf-8")).group(1)
    for colour in ("#EFEBE1", "#1E2A38", "#2F4F73"):
        assert colour in sheet
    for old in ("#eeeee4", "#163c32", "#f8f8f1", "#b8c2b7", "#8db6a6"):
        assert old not in sheet
