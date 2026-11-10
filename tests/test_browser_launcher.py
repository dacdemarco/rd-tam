"""The native browser controller must release its loopback server on close."""
import os
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import urllib.error
import urllib.request
from pathlib import Path

import pytest
pytest.importorskip("PySide6")
from PySide6.QtCore import QTimer
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import QDialog, QLineEdit

import main


def test_browser_controller_closes_http_server(tmp_path, monkeypatch):
    website = tmp_path / "dist" / "browser"
    website.mkdir(parents=True)
    (website / "index.html").write_text("<title>Local test</title>", encoding="utf-8")
    monkeypatch.setattr(main, "resource_root", lambda: tmp_path)
    monkeypatch.setattr(QDesktopServices, "openUrl", lambda url: True)
    original_show = QDialog.show
    served = {}

    def auto_close(dialog):
        original_show(dialog)
        served["address"] = dialog.findChild(QLineEdit).text()
        with urllib.request.urlopen(served["address"], timeout=3) as response:
            served["html"] = response.read()
        QTimer.singleShot(50, dialog.close)

    monkeypatch.setattr(QDialog, "show", auto_close)
    assert main.browser_mode() == 0
    assert b"Local test" in served["html"]
    with pytest.raises((urllib.error.URLError, OSError)):
        urllib.request.urlopen(served["address"], timeout=1)
