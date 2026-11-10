"""File copies that never leave a partial file or overwrite existing ones."""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import tempfile


def atomic_stream_copy(source, destination: Path) -> None:
    """Replace a managed file only after its complete replacement is written."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, filename = tempfile.mkstemp(prefix=".rd-tam-update-", suffix=".tmp", dir=destination.parent)
    temporary = Path(filename)
    try:
        with os.fdopen(descriptor, "wb") as output:
            shutil.copyfileobj(source, output, 1024 * 1024)
        os.replace(temporary, destination)
    finally:
        if temporary.exists():
            temporary.unlink()


def atomic_copy(source: Path, destination: Path) -> None:
    with source.open("rb") as stream:
        atomic_stream_copy(stream, destination)


def copy_missing_tree(source: Path, destination: Path) -> None:
    """Seed bundled models without replacing any existing model or user file."""
    destination.mkdir(parents=True, exist_ok=True)
    resolved_destination = destination.resolve()
    for source_file in sorted(source.rglob("*")):
        if not source_file.is_file():
            continue
        target = destination / source_file.relative_to(source)
        if target.exists():
            continue
        if not target.resolve().is_relative_to(resolved_destination):
            raise ValueError(f"Ruta fuera del destino: {target}")
        atomic_copy(source_file, target)
