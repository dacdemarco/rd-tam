// Logo fidelity gate: IoU of the SVG vs PNG alpha masks (>= 0.97) and identical inline path.
// Exit 0 ok, 1 mismatch, 2 missing file or bad argument.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(root, 'build', 'browsers');
const opts = {svg: 'assets/logo.svg', png: 'assets/logo-dark.png', html: 'web/index.html'};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  const key = argv[i].replace(/^--/, '');
  if (!(key in opts) || argv[i + 1] === undefined) { console.log(`Unknown argument ${argv[i]}`); process.exit(2); }
  opts[key] = argv[i + 1];
}
for (const file of Object.values(opts)) if (!fs.existsSync(file)) { console.log(`Missing file ${file}`); process.exit(2); }

const svg = fs.readFileSync(opts.svg, 'utf8');
const html = fs.readFileSync(opts.html, 'utf8');
const svgD = svg.match(/<path[^>]*\sd="([^"]*)"/)?.[1];
const htmlD = html.match(/<svg[^>]*id="rd-logo"[\s\S]*?<path[^>]*\sd="([^"]*)"/)?.[1];
const png = 'data:image/png;base64,' + fs.readFileSync(opts.png).toString('base64');

const {chromium} = createRequire(import.meta.url)('playwright');
// System Edge instead of a downloaded Chromium; same Blink rasterizer.
const browser = await chromium.launch({channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true});
try {
  const page = await browser.newPage();
  const iou = await page.evaluate(async ({svg, png}) => {
    const load = src => new Promise((ok, fail) => { const img = new Image(); img.onload = () => ok(img); img.onerror = fail; img.src = src; });
    const mask = img => {
      const canvas = Object.assign(document.createElement('canvas'), {width: 1024, height: 668});
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 1024, 668);
      const data = ctx.getImageData(0, 0, 1024, 668).data;
      return Uint8Array.from({length: data.length / 4}, (_, i) => data[i * 4 + 3] >= 128);
    };
    const styled = svg.replace('<svg', '<svg style="color:#000"');
    const a = mask(await load(URL.createObjectURL(new Blob([styled], {type: 'image/svg+xml'}))));
    const b = mask(await load(png));
    let both = 0, either = 0;
    for (let i = 0; i < a.length; i++) { both += a[i] & b[i]; either += a[i] | b[i]; }
    return either ? both / either : 0;
  }, {svg, png});
  const same = Boolean(svgD) && svgD === htmlD;
  console.log(`IoU=${iou.toFixed(4)}`);
  console.log(same ? 'Inline #rd-logo path matches' : 'Inline #rd-logo path differs from the SVG');
  process.exitCode = iou >= 0.97 && same ? 0 : 1;
} finally {
  await browser.close();
}
