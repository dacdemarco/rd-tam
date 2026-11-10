"""Prepare supplied brand assets and vendor Plotly, without remote UI resources."""
from pathlib import Path
import argparse
import json
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    from PIL import Image, ImageOps
    from rd_tam.engine import MODELS, LANGUAGES
    parser = argparse.ArgumentParser()
    parser.add_argument('--dark-logo', type=Path)
    parser.add_argument('--light-logo', type=Path)
    parser.add_argument('--branding-only', action='store_true')
    args = parser.parse_args()
    assets = ROOT / 'assets'
    assets.mkdir(exist_ok=True)
    for src, name in [(args.dark_logo, 'logo-dark.png'), (args.light_logo, 'logo-light.png')]:
        if src:
            image = Image.open(src).convert('RGBA')
            bbox = image.getchannel('A').getbbox()
            if bbox:
                image = image.crop(bbox)
            image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
            image.save(assets / name)
    if not (assets / 'logo-dark.png').exists():
        raise SystemExit('Indica --dark-logo y --light-logo la primera vez.')
    logo = Image.open(assets / 'logo-dark.png').convert('RGBA')
    mark = ImageOps.contain(logo, (370, 300), Image.Resampling.LANCZOS)
    icon = Image.new('RGBA', (512, 512), '#eeeee4')
    icon.alpha_composite(mark, ((512-mark.width)//2, (512-mark.height)//2))
    icon.save(assets / 'icon.png')
    icon.save(assets / 'icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
    icon.save(assets / 'icon.icns')
    web = ROOT / 'web'
    (web / 'vendor').mkdir(parents=True, exist_ok=True)
    if not args.branding_only:
        from plotly.offline import get_plotlyjs
        (web / 'vendor/plotly.min.js').write_text(get_plotlyjs(), encoding='utf-8')
    shutil.copytree(assets, web / 'assets', dirs_exist_ok=True)
    (web / 'config.json').write_text(json.dumps({'models':MODELS,'languages':LANGUAGES,'platform':'browser'}, ensure_ascii=False), encoding='utf-8')
    print('Recursos listos.')


if __name__ == '__main__':
    main()
