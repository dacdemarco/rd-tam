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
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.analysis-open').click();
    await (await chooser).setFiles([path.join(project, 'tests', 'fixtures', 'entrevista.srt'), path.join(project, 'tests', 'fixtures', 'notas.txt')]);
    await page.locator('.analysis-file').nth(1).waitFor();
    await page.locator('#analysis-keyword').fill('bosque');
    await page.waitForFunction(() => document.querySelectorAll('.analysis-result').length > 0);
    await page.locator('#theme-toggle').click();
    await page.screenshot({path: path.join(output, 'analysis-dark.png'), fullPage: true});
    results.push({captured: ['analysis-dark.png']});
  } else {
  await page.goto('http://127.0.0.1:8766/tests/analysis-browser.html');
  await page.waitForFunction(() => window.__ANALYSIS_QA_RESULT, null, { timeout: 60000 });
  const analysis = await page.evaluate(() => window.__ANALYSIS_QA_RESULT);
  assert.deepEqual(analysis.errors, [], JSON.stringify(analysis));
  results.push({ test: 'Analysis DOM and Plotly', ...analysis });
  await page.screenshot({ path: path.join(output, 'analysis-stress.png'), fullPage: true });

  await page.goto('http://127.0.0.1:8766/dist/browser/');
  await page.waitForFunction(() => typeof window.createBrowserBridge === 'function');
  await page.waitForFunction(() => performance.getEntriesByName('rd-boot-end').length, null, { timeout: 15000 });
  assert.ok(await page.locator('#analysis-panel').isVisible() && !(await page.locator('#transcribe-panel').isVisible()) && !(await page.locator('.tabs').isVisible()), 'Only the analysis tool is shown');
  assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => /onnx|ffmpeg|transformers|whisper/i.test(entry.name)).length), 0);
  results.push({ test: 'Analysis only, no transcription engine loaded', passed: true });
  await page.locator('#theme-toggle').click();
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
