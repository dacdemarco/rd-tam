"""Collect installed dependency notices without accessing the network."""
from __future__ import annotations

import importlib.metadata
import json
from pathlib import Path
import re


def collect(destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    inventory = []
    for dist in sorted(importlib.metadata.distributions(), key=lambda d: d.metadata.get("Name", "").lower()):
        name = dist.metadata.get("Name", "unknown")
        files = []
        for entry in dist.files or []:
            basename = Path(str(entry)).name.lower()
            if basename.startswith(("license", "licence", "copying", "notice", "copyright")):
                source = Path(dist.locate_file(entry))
                if source.is_file():
                    safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", name)
                    target = destination / safe_name / str(entry).replace("../", "").replace("..\\", "")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(source.read_bytes())
                    files.append(str(target.relative_to(destination)))
        inventory.append({"name": name, "version": dist.version, "license": dist.metadata.get("License-Expression") or dist.metadata.get("License"), "notice_files": files})
    (destination / "inventory.json").write_text(json.dumps(inventory, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    collect(Path(__file__).resolve().parents[1] / "build" / "licenses")
