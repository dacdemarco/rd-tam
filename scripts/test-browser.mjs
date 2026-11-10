// Developer QA only. Uses the project's Playwright devDependency (browsers in build/browsers).
// No audio/model data is sent to a remote service.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv.find(value => value.startsWith('--browser='))?.split('=')[1] || process.env.RD_QA_BROWSER || 'edge';
const screenshotsOnly = process.argv.includes('--screenshots-only');
assert.ok(['edge', 'chrome', 'opera', 'firefox', 'webkit'].includes(target), 'Browser target must be edge, chrome, opera, firefox, or webkit');
const output = path.join(project, 'artifacts', 'qa', ...(target === 'edge' ? [] : [target]));
await fs.mkdir(output, { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(project, 'build', 'browsers');
const require = createRequire(import.meta.url);
const playwright = require('playwright');

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.srt': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const server = http.createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filename = path.resolve(project, '.' + pathname);
    if (!filename.startsWith(project + path.sep)) { response.writeHead(403); response.end(); return; }
    const bytes = await fs.readFile(filename);
    response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' }); response.end(bytes);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8766, '127.0.0.1', resolve); });

const results = [], errors = [];
let browser, browserVersion;
try {
  const launchOptions = {headless: true};
  if (target === 'edge') launchOptions.channel = 'msedge';
  else if (target === 'chrome') launchOptions.channel = 'chrome';
  else if (target === 'opera') launchOptions.executablePath = process.env.RD_OPERA_PATH || 'C:/Users/dacp2/AppData/Local/Programs/Opera GX/opera.exe';
  const engine = target === 'firefox' ? playwright.firefox : target === 'webkit' ? playwright.webkit : playwright.chromium;
  browser = await engine.launch(launchOptions);
  browserVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  if (screenshotsOnly) {
    await page.goto('http://127.0.0.1:8766/dist/browser/');
    await page.waitForFunction(() => typeof window.createBrowserBridge === 'function');
    await page.screenshot({path: path.join(output, 'transcribe-light.png'), fullPage: true});
    await page.locator('#tab-analysis').click();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.analysis-open').click();
    await (await chooser).setFiles([path.join(project, 'tests', 'fixtures', 'entrevista.srt'), path.join(project, 'tests', 'fixtures', 'notas.txt')]);
    await page.locator('.analysis-file').nth(1).waitFor();
    await page.locator('#analysis-keyword').fill('bosque');
    await page.waitForFunction(() => document.querySelectorAll('.analysis-result').length > 0);
    await page.locator('#theme-toggle').click();
    await page.screenshot({path: path.join(output, 'analysis-dark.png'), fullPage: true});
    results.push({captured: ['transcribe-light.png', 'analysis-dark.png']});
  } else {
  await page.goto('http://127.0.0.1:8766/tests/analysis-browser.html');
  await page.waitForFunction(() => window.__ANALYSIS_QA_RESULT, null, { timeout: 60000 });
  const analysis = await page.evaluate(() => window.__ANALYSIS_QA_RESULT);
  assert.deepEqual(analysis.errors, [], JSON.stringify(analysis));
  results.push({ test: 'Analysis DOM and Plotly', ...analysis });
  await page.screenshot({ path: path.join(output, 'analysis-stress.png'), fullPage: true });

  await page.goto('http://127.0.0.1:8766/dist/browser/');
  await page.waitForFunction(() => typeof window.createBrowserBridge === 'function');
  await page.screenshot({ path: path.join(output, 'transcribe-light.png'), fullPage: true });
  await page.locator('#language-button').click();
  await page.locator('#language-search').fill('espa');
  await page.getByRole('option', { name: 'Español', exact: true }).click();
  assert.equal(await page.locator('#language-label').textContent(), 'Español');
  results.push({ test: 'Language search and selection', passed: true });
  await page.locator('#theme-toggle').click();
  await page.screenshot({ path: path.join(output, 'transcribe-dark.png'), fullPage: true });
  await page.locator('#tab-analysis').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.analysis-open').click();
  await (await chooser).setFiles([path.join(project, 'tests', 'fixtures', 'entrevista.srt'), path.join(project, 'tests', 'fixtures', 'notas.txt')]);
  await page.locator('.analysis-file').nth(1).waitFor();
  await page.locator('#analysis-keyword').fill('bosque');
  await page.waitForFunction(() => document.querySelectorAll('.analysis-result').length === 6);
  assert.ok(await page.locator('.analysis-timeline .main-svg').first().evaluate(svg => svg.getBoundingClientRect().width) > 400, 'Built chart SVG must retain its full width');
  await page.screenshot({ path: path.join(output, 'analysis-dark.png'), fullPage: true });
  await page.locator('#theme-toggle').click();
  await page.screenshot({ path: path.join(output, 'analysis-light.png'), fullPage: true });
  results.push({ test: 'Built app TXT/SRT import and KWIC', passed: true });

  const pngEvent = page.waitForEvent('download');
  await page.locator('[data-action="png"]').click();
  const png = await pngEvent; const pngPath = path.join(output, 'timeline.png'); await png.saveAs(pngPath);
  const pngBytes = await fs.readFile(pngPath);
  assert.equal(pngBytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const htmlEvent = page.waitForEvent('download');
  await page.locator('[data-action="html"]').click();
  const html = await htmlEvent; const htmlPath = path.join(output, 'timeline.html'); await html.saveAs(htmlPath);
  assert.ok((await fs.stat(htmlPath)).size > 4_000_000);
  const exported = await context.newPage();
  await exported.goto(pathToFileURL(htmlPath).href);
  await exported.waitForFunction(() => document.querySelectorAll('.js-plotly-plot').length === 2);
  results.push({ test: 'PNG and standalone HTML downloads', passed: true });
  await exported.close();

  const decoderName = (await fs.readdir(path.join(project, 'dist', 'browser', 'assets'))).find(name => /^audio-decoder-.*\.js$/.test(name));
  assert.ok(decoderName, 'Built decoder chunk missing');
  const decoderURL = `http://127.0.0.1:8766/dist/browser/assets/${decoderName}`;
  const native = await page.evaluate(async url => {
    const exports = await import(url), decode = exports.decodeMedia || exports.d || Object.values(exports).find(value => typeof value === 'function');
    const rate = 48000, count = rate * 2, bytes = new Uint8Array(44 + count * 4), view = new DataView(bytes.buffer);
    const text = (at, value) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, count * 4, true);
    for (let i = 0; i < count; i++) { const sample = Math.round(Math.sin(i / rate * Math.PI * 880) * 15000); view.setInt16(44 + i * 4, sample, true); view.setInt16(46 + i * 4, -sample, true); }
    const stages = [], pcm = await decode(new File([bytes], 'stereo.wav', {type: 'audio/wav'}), {onStage: stage => stages.push(stage)});
    return {samples: pcm.length, peak: pcm.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0), stages};
  }, decoderURL);
  assert.equal(native.samples, 32000); assert.ok(native.peak < .001, `Stereo should average to mono: ${native.peak}`);
  results.push({ test: 'WAV decode, 48kHz stereo to 16kHz mono', decoder: native.stages.includes('Preparando decodificador') ? 'ffmpeg-wasm' : 'native-web-audio', passed: true, ...native });

  const videoPath = path.join(project, 'tests', 'fixtures', 'media', 'decode-video.mkv');
  try {
    const videoBytes = await fs.readFile(videoPath);
    const video = await page.evaluate(async ({url, bytes}) => {
      const exports = await import(url), decode = exports.decodeMedia || exports.d || Object.values(exports).find(value => typeof value === 'function');
      const stages = [], nativeAudio = window.AudioContext, legacyAudio = window.webkitAudioContext;
      try {
        // Edge can decode this MKV natively; explicitly exercise browsers without
        // Web Audio decoding so that WASM loading and video demuxing are covered.
        window.AudioContext = undefined; window.webkitAudioContext = undefined;
        const pcm = await decode(new File([new Uint8Array(bytes)], 'video.mkv', {type: 'video/x-matroska'}), {onStage: stage => stages.push(stage)});
        return {samples: pcm.length, peak: pcm.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0), stages};
      } finally { window.AudioContext = nativeAudio; window.webkitAudioContext = legacyAudio; }
    }, {url: decoderURL, bytes: Array.from(videoBytes)});
    assert.ok(video.samples >= 15900 && video.samples <= 16100); assert.ok(video.peak > .01);
    assert.ok(video.stages.includes('Preparando decodificador'), 'MKV should exercise FFmpeg fallback');
    results.push({ test: 'MKV video decode through bundled FFmpeg WASM with Web Audio unavailable', passed: true, ...video });
  } catch (error) {
    if (error.code === 'ENOENT') results.push({ test: 'MKV video decode', skipped: 'Generate tests/fixtures/media/decode-video.mkv with FFmpeg first' });
    else throw error;
  }
  if (process.argv.includes('--inference')) {
    await page.goto('http://127.0.0.1:8766/dist/browser/');
    await page.waitForFunction(() => typeof window.createBrowserBridge === 'function');
    await page.locator('[data-get="tiny"]').click();
    await page.locator('[data-row="tiny"][data-status="ready"]').waitFor({timeout: 600000});
    await page.locator('[data-model="tiny"]').click();
    await page.locator('#language-button').click();
    await page.locator('#language-search').fill('ingl');
    await page.getByRole('option', { name: 'Inglés', exact: true }).click();
    let lastStage = '', lastReported = 0;
    await page.exposeFunction('qaStage', stage => {
      const normalized = stage.replace(/\s*·\s*\d+\s*%/g, '');
      if (normalized !== lastStage || Date.now() - lastReported > 15000) { console.log(`Whisper browser: ${stage}`); lastStage = normalized; lastReported = Date.now(); }
    });
    await page.evaluate(() => new MutationObserver(() => window.qaStage(document.querySelector('#progress-stage').textContent)).observe(document.querySelector('#progress-stage'), {childList: true, characterData: true, subtree: true}));
    const fileChooser = page.waitForEvent('filechooser'); await page.locator('#open-media').click();
    await (await fileChooser).setFiles(path.join(project, 'tests', 'fixtures', 'media', 'voice.wav'));
    await page.locator('#start-jobs').click();
    await page.waitForFunction(() => ['Completado', 'Error'].includes(document.querySelector('#paper-status').textContent), null, {timeout: 600000});
    const inference = await page.evaluate(() => ({status: document.querySelector('#paper-status').textContent, stage: document.querySelector('#progress-stage').textContent, percent: document.querySelector('#progress-percent').textContent, text: [...document.querySelectorAll('.segment p')].map(node => node.textContent).join(' '), timestamps: [...document.querySelectorAll('.segment time')].map(node => node.textContent)}));
    assert.equal(inference.status, 'Completado', inference.stage);
    assert.equal(inference.percent, '100%'); assert.ok(inference.text.length > 15); assert.ok(inference.timestamps.length > 0);
    assert.match(inference.text, /forest|transcription/i, 'Whisper should recognize a meaningful word from the fixture');
    const pairedEvent = page.waitForEvent('download'); await page.locator('#export-job').click();
    const paired = await pairedEvent, pairedPath = path.join(output, 'whisper-export.zip'); await paired.saveAs(pairedPath);
    const pairedBytes = await fs.readFile(pairedPath); assert.equal(pairedBytes.subarray(0, 4).toString('hex'), '504b0304');
    assert.ok(pairedBytes.includes(Buffer.from('.txt')) && pairedBytes.includes(Buffer.from('.srt')));
    await page.screenshot({path: path.join(output, 'transcription-real.png'), fullPage: true});
    results.push({test: 'Real Whisper tiny inference and paired TXT/SRT export', passed: true, ...inference});
  }
  assert.deepEqual(errors, [], 'Browser console errors');
  }
} catch (error) {
  errors.push(error.stack || error.message); process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  const report = { browser: target, version: browserVersion, distribution: ['firefox', 'webkit'].includes(target) ? `Playwright ${target} engine` : `Installed ${target}`, results, errors, passed: errors.length === 0 };
  if (!screenshotsOnly) await fs.writeFile(path.join(output, 'browser-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
