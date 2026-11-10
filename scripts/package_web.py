"""Package an already-built static browser edition without publishing it."""
from __future__ import annotations

from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "dist" / "browser"
DESTINATION = ROOT / "release" / "RD-TAM-navegador.zip"

HELP = """RD-TAM — Transcripción y Análisis Multimedia
Versión para navegador

La carpeta completa se puede servir desde cualquier alojamiento estático HTTPS.
No abras index.html con doble clic: los motores necesitan HTTP(S).

Para abrirla localmente:
  Windows: abrir Iniciar.exe (si viene incluido; no necesita Python).
  Windows con Python 3: abrir Iniciar-Windows.cmd
  macOS/Linux: ejecutar python3 Iniciar.py

También puedes usar el lanzador nativo de RD-TAM con --browser cuando su
distribución incluya la versión web.

Los archivos se procesan dentro del navegador. Los modelos se descargan al
usarlos por primera vez. No se suben audios o videos ni se necesita una API key.
El navegador puede eliminar su caché; la caché no garantiza disponibilidad
permanente sin conexión. Los modelos del escritorio son distintos.

Compatibilidad prevista: navegadores recientes Safari, Chrome, Opera y Firefox.
Verifica la versión que vayas a distribuir. Archivos de hasta 512 MB; el límite
efectivo depende de la memoria y duración del audio. Para material muy largo,
usa la aplicación de escritorio.
"""

WINDOWS_LAUNCHER = """@echo off
cd /d "%~dp0"
if exist Iniciar.exe (
  Iniciar.exe
  exit /b
)
where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 Iniciar.py
) else (
  python Iniciar.py
)
if %errorlevel% neq 0 (
  echo Necesitas Python 3 o el lanzador nativo de RD-TAM para abrir este paquete localmente.
  pause
)
"""


def main() -> None:
    if not (SOURCE / "index.html").is_file():
        raise SystemExit("Primero genera dist/browser con npm run build.")
    DESTINATION.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(DESTINATION, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for source in sorted(SOURCE.rglob("*")):
            if source.is_file():
                archive.write(source, source.relative_to(SOURCE).as_posix())
        archive.write(ROOT / "scripts" / "launch_browser.py", "Iniciar.py")
        archive.write(ROOT / "THIRD_PARTY.md", "THIRD_PARTY.md")
        launcher = ROOT / "build/web-launcher/dist/Iniciar.exe"
        if launcher.is_file():
            archive.write(launcher, "Iniciar.exe")
        archive.writestr("Iniciar-Windows.cmd", WINDOWS_LAUNCHER.replace("\n", "\r\n"))
        archive.writestr("LEEME.txt", HELP)
    print(DESTINATION)


if __name__ == "__main__":
    main()
