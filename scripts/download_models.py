"""Prepare a self-contained model folder for a portable, offline distribution."""
from __future__ import annotations

import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Descarga modelos Whisper para uso sin conexión.")
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    parser.add_argument("--models", nargs="+", choices=("tiny", "small", "medium"), default=["tiny", "small", "medium"])
    args = parser.parse_args()
    from faster_whisper.utils import download_model
    for model in dict.fromkeys(args.models):
        destination = args.data_dir.resolve() / "models" / model
        destination.mkdir(parents=True, exist_ok=True)
        print(f"Descargando {model}: {destination}", flush=True)
        download_model(model, output_dir=str(destination), cache_dir=str(args.data_dir.resolve() / "cache"))
        if not (destination / "model.bin").is_file():
            raise RuntimeError(f"La descarga de {model} quedó incompleta.")
    print("Modelos preparados. Copia la carpeta data completa junto a la aplicación portátil.")


if __name__ == "__main__":
    main()
