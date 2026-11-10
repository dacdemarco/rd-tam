# Native build only: run on each operating system / CPU architecture.
from pathlib import Path
import sys
from PyInstaller.utils.hooks import collect_all, copy_metadata

root = Path(SPECPATH)
datas = [(str(root / "web"), "web"), (str(root / "assets"), "assets")]
if (root / "dist" / "browser" / "index.html").is_file():
    datas.append((str(root / "dist" / "browser"), "browser"))
if (root / "build" / "licenses").is_dir():
    datas.append((str(root / "build" / "licenses"), "licenses"))
datas.append((str(root / "THIRD_PARTY.md"), "."))
binaries = []
hiddenimports = ["multiprocessing", "multiprocessing.popen_spawn_win32"] if sys.platform == "win32" else ["multiprocessing"]
for package in ("faster_whisper", "ctranslate2", "av", "tokenizers", "onnxruntime"):
    package_data, package_binaries, package_hidden = collect_all(package)
    datas += package_data
    binaries += package_binaries
    hiddenimports += package_hidden
for distribution in ("faster-whisper", "huggingface-hub", "tokenizers", "ctranslate2", "av", "onnxruntime", "tqdm"):
    datas += copy_metadata(distribution)

a = Analysis(
    [str(root / "main.py")],
    pathex=[str(root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "IPython", "jupyter", "pytest", "torch", "tensorflow", "transformers"],
    noarchive=False,
)
pyz = PYZ(a.pure)
icon = root / "assets" / ("icon.icns" if sys.platform == "darwin" else "icon.ico")
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="RD-TAM",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    icon=str(icon) if icon.exists() else None,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="RD-TAM")
if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="RD-TAM.app",
        icon=str(root / "assets" / "icon.icns"),
        bundle_identifier="studio.rd.tam",
        info_plist={
            "CFBundleName": "RD-TAM",
            "CFBundleDisplayName": "RD-TAM",
            "CFBundleShortVersionString": "0.2.2",
            "NSHighResolutionCapable": True,
            "NSPrincipalClass": "NSApplication",
        },
    )
