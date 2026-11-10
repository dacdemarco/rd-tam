"""Build desktop bundles on the current operating system; never cross-compile."""
from __future__ import annotations

import argparse
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import uuid

from collect_licenses import collect
from delivery_files import copy_missing_tree

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"


def run(*args: str | Path) -> None:
    subprocess.run([str(arg) for arg in args], cwd=ROOT, check=True)


def inno_compiler(explicit: str | None) -> Path | None:
    candidates = [explicit, shutil.which("ISCC"), r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe", r"C:\Program Files\Inno Setup 6\ISCC.exe"]
    return next((Path(path) for path in candidates if path and Path(path).is_file()), None)


def mark_portable(folder: Path, models_dir: Path | None = None) -> None:
    (folder / "portable.flag").write_text("RD-TAM portable\n", encoding="utf-8")
    (folder / "data" / "models").mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "README.md", folder / "LEEME.md")
    if models_dir:
        copy_missing_tree(models_dir, folder / "data" / "models")
        model_license = ROOT / "licenses" / "browser" / "whisper-LICENSE.txt"
        if model_license.is_file() and not (folder / "data" / "models" / "LICENSE-Whisper.txt").exists():
            shutil.copy2(model_license, folder / "data" / "models" / "LICENSE-Whisper.txt")


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera los binarios de RD-TAM para este sistema.")
    parser.add_argument("--installer", action="store_true", help="Exige y genera instalador Windows; macOS siempre genera DMG.")
    parser.add_argument("--iscc", help="Ruta opcional a ISCC.exe de Inno Setup 6.")
    parser.add_argument("--skip-freeze", action="store_true", help="Empaqueta un dist ya construido.")
    parser.add_argument("--models-dir", type=Path, help="Incluye esta carpeta de modelos en el paquete portátil.")
    args = parser.parse_args()
    if args.models_dir:
        args.models_dir = args.models_dir.resolve()
        if not args.models_dir.is_dir():
            parser.error("--models-dir debe ser una carpeta existente con los subdirectorios de modelos.")
    if sys.platform == "win32" and args.installer and not inno_compiler(args.iscc):
        parser.error("Instala Inno Setup 6 o indica --iscc con la ruta a ISCC.exe.")
    required = [ROOT / "web" / "vendor" / "plotly.min.js", ROOT / "assets" / "icon.png"]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        parser.error("Faltan recursos locales: " + ", ".join(missing) + ". Ejecuta scripts/prepare_assets.py.")
    DIST.mkdir(exist_ok=True)
    if not args.skip_freeze:
        collect(ROOT / "build" / "licenses")
        run(sys.executable, "-m", "PyInstaller", "--noconfirm", "rd_tam.spec")
    machine = platform.machine().lower()
    arch = "arm64" if machine in {"arm64", "aarch64"} else "x64" if machine in {"amd64", "x86_64"} else machine
    system = {"win32": "windows", "darwin": "macos"}.get(sys.platform, "linux")
    stem = f"RD-TAM-0.2.1-{system}-{arch}"
    if sys.platform == "darwin":
        stage = ROOT / "build" / "packages" / uuid.uuid4().hex
        portable = stage / "RD-TAM"
        portable.mkdir(parents=True)
        run("ditto", DIST / "RD-TAM.app", portable / "RD-TAM.app")
        mark_portable(portable, args.models_dir)
        run("ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", portable, DIST / f"{stem}-portable.zip")
        dmg_stage = stage / "dmg"
        dmg_stage.mkdir()
        run("ditto", DIST / "RD-TAM.app", dmg_stage / "RD-TAM.app")
        (dmg_stage / "Applications").symlink_to("/Applications", target_is_directory=True)
        run("hdiutil", "create", "-ov", "-volname", "RD-TAM", "-srcfolder", dmg_stage, "-format", "UDZO", DIST / f"{stem}.dmg")
    else:
        portable = DIST / "RD-TAM"
        if not portable.is_dir():
            parser.error(f"No existe el binario compilado: {portable}")
        mark_portable(portable, args.models_dir)
        if sys.platform == "win32":
            shutil.make_archive(str(DIST / f"{stem}-portable"), "zip", root_dir=DIST, base_dir="RD-TAM")
            compiler = inno_compiler(args.iscc)
            if compiler:
                run(compiler, f"/DAppVersion=0.2.1", f"/DOutputName={stem}-setup", ROOT / "packaging" / "windows.iss")
    print(f"Archivos generados en {DIST}")


if __name__ == "__main__":
    main()
