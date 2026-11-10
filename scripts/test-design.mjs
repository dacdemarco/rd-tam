// UI-only QA. The browser adapter is replaced with deterministic local events;
// this script does not run Whisper or download models.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts', 'qa', 'design');
const fontsOnly = process.argv.includes('--fonts-only');
await fs.mkdir(output, {recursive:true});
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(root,'build','browsers');
const require = createRequire(import.meta.url);
const playwright = require('playwright');
const settings = JSON.parse(await fs.readFile(path.join(root, 'web', 'config.json'), 'utf8'));
const documents = await Promise.all(['entrevista.srt', 'notas.txt'].map(async (name, index) => ({id:`qa-${index}`, name, text:await fs.readFile(path.join(root, 'tests', 'fixtures', name), 'utf8')})));
const stub = `
const settings = ${JSON.stringify(settings)};
const documents = ${JSON.stringify(documents)};
function signal(){const callbacks=[];return{connect(fn){callbacks.push(fn)},emit(value){callbacks.forEach(fn=>fn(value))}}}
export async function createBrowserBridge(){
 const bridge={stateChanged:signal(),documentsLoaded:signal(),notified:signal()};
 window.__qaEmit=snapshot=>bridge.stateChanged.emit(JSON.stringify(snapshot));
 window.__qaDocuments=docs=>bridge.documentsLoaded.emit(JSON.stringify(docs));
 Object.assign(bridge,{
  config(callback){callback(JSON.stringify(settings))},
  ready(){window.__qaReady=true;window.__qaEmit({jobs:[],current_id:null})},
  openAnalysis(){window.__qaDocuments(documents)},openMedia(){},startJobs(){},downloadModel(id){window.__qaDownload=id},cancelDownload(){},pause(){},resume(){},cancel(){},exportJob(){},saveText(){},saveImage(){},saveChart(){}
 });return bridge;
}`;
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.woff2':'font/woff2','.png':'image/png'};
const server = http.createServer(async (request,response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filename = path.resolve(root,'.'+pathname);
    if (!filename.startsWith(root+path.sep)) {response.writeHead(403);response.end();return;}
    const bytes = await fs.readFile(filename);
    response.writeHead(200,{'Content-Type':types[path.extname(filename)] || 'application/octet-stream'});
    response.end(bytes);
  } catch {response.writeHead(404);response.end();}
});
await new Promise((resolve,reject) => {server.once('error',reject);server.listen(8767,'127.0.0.1',resolve);});
const checks = [], errors = [];
let browser, context, recording;
const pass = (name,details) => checks.push({name,details});
try {
  browser = await playwright.chromium.launch({channel:'msedge',headless:true});
  context = await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,reducedMotion:'no-preference',recordVideo:process.argv.includes('--record') ? {dir:path.join(output,'motion'),size:{width:1280,height:900}} : undefined});
  await context.route('**/web/browser-engine.js',route => route.fulfill({contentType:'text/javascript',body:stub}));
  const page = await context.newPage();
  recording = page.video();
  page.on('pageerror',error => errors.push(error.message));
  const settle = async () => {await page.evaluate(() => document.fonts.ready);await page.waitForTimeout(380);try{await page.waitForFunction(() => document.getAnimations().filter(a => a.effect.getTiming().iterations !== Infinity).length === 0,null,{timeout:8000});}catch(e){throw new Error('Animations still running: '+JSON.stringify(await page.evaluate(() => document.getAnimations().filter(a => a.effect.getTiming().iterations !== Infinity).map(a => [a.animationName||a.transitionProperty||'waapi',a.effect?.target?.className||a.effect?.target?.tagName,a.effect?.getTiming().iterations]))));}};
  await page.goto('http://127.0.0.1:8767/web/');
  await page.waitForFunction(() => window.__qaReady);
  await page.waitForFunction(() => performance.getEntriesByName('rd-boot-end').length,null,{timeout:12000});

  // Boot: the logo stage runs, then every cell assembles; a key press skips all of it.
  const bootPage = await context.newPage();
  bootPage.on('pageerror',error => errors.push('boot: '+error.message));
  await bootPage.goto('http://127.0.0.1:8767/web/',{waitUntil:'commit'});
  await bootPage.waitForSelector('.splash canvas',{timeout:3000});
  await bootPage.waitForFunction(() => document.querySelector('.splash canvas')?.width > 300,null,{timeout:5000});
  // The logo is drawn by a moving pen: early on only a small part of it is lit.
  const litCounts = await bootPage.evaluate(() => new Promise(resolve => {
    const canvas = document.querySelector('.splash canvas'),ctx = canvas.getContext('2d'),counts = [],end = performance.now()+1000;
    const box = [canvas.width*.3,canvas.height*.3,canvas.width*.4,canvas.height*.4];
    const tick = () => {
      const pixels = ctx.getImageData(...box).data;
      let lit = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i+1] > 120) lit++;
      counts.push(lit);
      if (performance.now() < end) requestAnimationFrame(tick); else resolve(counts);
    };
    tick();
  }));
  assert.ok(litCounts.at(-1) > 0 && litCounts[0] < litCounts.at(-1)/2,'lit pixels '+litCounts.join());
  pass('The logo draws itself progressively',{first:litCounts[0],last:litCounts.at(-1)});
  await bootPage.waitForFunction(() => document.querySelectorAll('.trace').length > 3 && document.querySelectorAll('.band-in').length > 0,null,{timeout:8000,polling:'raf'});
  pass('Boot draws frames and fills cells band by band');
  await bootPage.waitForFunction(() => performance.getEntriesByName('rd-boot-end').length && !document.querySelector('.splash'),null,{timeout:12000});
  const bootSpan = await bootPage.evaluate(() => performance.getEntriesByName('rd-boot-end')[0].startTime - performance.getEntriesByName('rd-boot-start')[0].startTime);
  assert.ok(bootSpan <= 7000,'boot span '+bootSpan);
  assert.deepEqual(await bootPage.evaluate(() => [document.querySelectorAll('.trace').length,document.querySelectorAll('.band-in').length,document.documentElement.classList.contains('booting')]),[0,0,false]);
  pass('Boot ends clean: no overlays left and the interface is visible',{bootSpan});
  await bootPage.goto('http://127.0.0.1:8767/web/',{waitUntil:'commit'});
  await bootPage.waitForSelector('.splash canvas',{timeout:3000});
  const pressedAt = await bootPage.evaluate(() => performance.now());
  await bootPage.keyboard.press('Space');
  await bootPage.waitForFunction(() => performance.getEntriesByName('rd-boot-end').length,null,{timeout:2000});
  const skipDelay = await bootPage.evaluate(at => performance.getEntriesByName('rd-boot-end')[0].startTime - at,pressedAt);
  assert.ok(skipDelay <= 300 && !(await bootPage.locator('.splash').count()),'skip delay '+skipDelay);
  pass('A key press skips the boot',{skipDelay});

  // Typing: a word change types on with steps(); a digits-only change does not animate.
  await bootPage.waitForFunction(() => window.__qaReady);
  const stageAnimations = () => bootPage.evaluate(() => document.querySelector('#progress-stage').getAnimations().map(a => ({duration:a.effect.getTiming().duration,easing:a.effect.getTiming().easing})));
  const typingJob = {id:'typing',name:'tipeo.wav',status:'processing',model:'tiny',language:'es',stage:'Transcribiendo',progress:5,segments:[]};
  await bootPage.evaluate(v => window.__qaEmit(v),{jobs:[typingJob],current_id:'typing'});
  const typing = await stageAnimations();
  assert.ok(typing.length===1 && typing[0].duration<=400 && typing[0].easing.includes('steps('),JSON.stringify(typing));
  await bootPage.evaluate(v => window.__qaEmit(v),{jobs:[{...typingJob,stage:'Descargando · 10 %'}],current_id:'typing'});
  await bootPage.waitForTimeout(450);
  await bootPage.evaluate(v => window.__qaEmit(v),{jobs:[{...typingJob,stage:'Descargando · 20 %'}],current_id:'typing'});
  assert.deepEqual(await stageAnimations(),[],'digits-only change must not animate');
  pass('Typing runs on word changes only',typing);

  // Decode: new rows resolve left to right without layout shift; old rows never re-animate.
  const seg = (start,text) => ({start,end:start+2,text});
  const s0 = seg(0,'Primera frase de la prueba.'), s1 = seg(2,'Segunda frase, bastante más larga, que se decodifica de izquierda a derecha.');
  await bootPage.evaluate(v => window.__qaEmit(v),{jobs:[{...typingJob,segments:[s0]}],current_id:'typing'});
  await bootPage.waitForTimeout(400);
  await bootPage.evaluate(v => window.__qaEmit(v),{jobs:[{...typingJob,segments:[s0,s1]}],current_id:'typing'});
  const samples = [];
  for (let i = 0; i < 7; i++) {
    samples.push(await bootPage.evaluate(() => {
      const rows = document.querySelectorAll('#transcript .segment:not(.provisional)'), old = rows[0].getBoundingClientRect(), row = rows[1], p = row.querySelector('p'), layer = row.querySelector('.decode-layer');
      return {oldTop:old.top,oldHeight:old.height,height:row.getBoundingClientRect().height,p:p.textContent,k:layer ? Number(layer.dataset.resolved) : null,prefixOk:layer ? layer.textContent.slice(0,Number(layer.dataset.resolved)) === p.textContent.slice(0,Number(layer.dataset.resolved)) : true};
    }));
    await bootPage.waitForTimeout(50);
  }
  const decoded = samples.filter(x => x.k !== null);
  assert.ok(decoded.length > 0,'no decode layer was sampled');
  assert.ok(samples.every(x => x.oldTop === samples[0].oldTop && x.oldHeight === samples[0].oldHeight && x.height === samples[0].height && x.p === s1.text && x.prefixOk),JSON.stringify(samples));
  assert.ok(decoded.every((x,i) => i === 0 || x.k >= decoded[i-1].k),JSON.stringify(decoded));
  assert.equal(await bootPage.locator('.decode-layer').count(),0);
  await bootPage.evaluate(v => window.__qaEmit(v),{jobs:[{...typingJob,segments:[s0,s1,seg(4,'Tercera.')]}],current_id:'typing'});
  const oldRows = await bootPage.evaluate(() => [...document.querySelectorAll('#transcript .segment')].slice(0,2).map(row => row.getAnimations({subtree:true}).length + row.querySelectorAll('.decode-layer').length));
  assert.deepEqual(oldRows,[0,0]);
  pass('New segments decode left to right without layout shift',{samples:samples.length,decoded:decoded.length});
  await bootPage.evaluate(v => window.__qaEmit(v),{jobs:[{...typingJob,progress:37}],current_id:'typing'});
  const blocks = await bootPage.evaluate(() => ({width:document.querySelector('#progress-fill').style.width,now:document.querySelector('#progress-track').getAttribute('aria-valuenow'),mask:getComputedStyle(document.querySelector('.progress-track')).maskImage || getComputedStyle(document.querySelector('.progress-track')).webkitMaskImage}));
  assert.ok(blocks.width==='35%' && blocks.now==='37' && blocks.mask.includes('repeating-linear-gradient'),JSON.stringify(blocks));
  pass('Progress fills in 5% blocks on a segmented track',blocks);
  await bootPage.close();

  // The animations run even when the system asks for reduced motion.
  const osReduced = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await osReduced.route('**/web/browser-engine.js',route => route.fulfill({contentType:'text/javascript',body:stub}));
  const osPage = await osReduced.newPage();
  await osPage.goto('http://127.0.0.1:8767/web/',{waitUntil:'commit'});
  await osPage.waitForSelector('.splash canvas',{timeout:3000});
  await osReduced.close();
  pass('The system reduced-motion setting does not turn the animations off by itself');

  const fonts = await page.evaluate(async () => {
    const wanted = [['RD Departure Mono',400,'11px']];
    await Promise.all(wanted.map(([name,weight,size]) => document.fonts.load(`${weight} ${size} "${name}"`)));
    await document.fonts.ready;
    return wanted.map(([name,weight]) => ({name,weight,loaded:[...document.fonts].some(face => face.family.replaceAll('"','').replaceAll("'",'') === name && face.weight === String(weight) && face.status === 'loaded')}));
  });
  assert.ok(fonts.every(font => font.loaded),JSON.stringify(fonts));pass('Bundled Departure Mono loaded',fonts);
  const family = await page.locator('body').evaluate(node => getComputedStyle(node).fontFamily);
  assert.match(family,/^"RD Departure Mono"/);
  for (const [role,selectors] of [['"RD Departure Mono"',['body','.tab','.section-label','.analysis-section-label','.model span','.analysis-search input','#open-media','#language-label']]]) {
    for (const selector of selectors) assert.ok((await page.locator(selector).first().evaluate(node => getComputedStyle(node).fontFamily)).startsWith(role),selector);
  }
  pass('Both tabs use the same font per role',family);
  const monoSizes = () => page.evaluate(() => [...document.querySelectorAll('body *')].filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).fontFamily.startsWith('"RD Departure Mono"')).map(node => getComputedStyle(node).fontSize).filter(size => size !== '11px' && size !== '22px'));
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');await cdp.send('CSS.enable');
  const {root:documentRoot} = await cdp.send('DOM.getDocument');
  const renderedFonts = {};
  for (const selector of ['#tab-transcribe','#tab-analysis','.model span']) {
    const {nodeId} = await cdp.send('DOM.querySelector',{nodeId:documentRoot.nodeId,selector});
    const {fonts:actualFonts} = await cdp.send('CSS.getPlatformFontsForNode',{nodeId});
    const used = actualFonts.filter(font=>font.glyphCount>0);
    assert.ok(used.length>0,selector+' should contain rendered text');
    assert.ok(used.every(font=>font.isCustomFont && /departure\s*mono/i.test(font.familyName)),JSON.stringify({selector,used}));
    renderedFonts[selector] = used;
  }
  assert.equal(renderedFonts['#tab-transcribe'][0].postScriptName,renderedFonts['#tab-analysis'][0].postScriptName);
  const otherFonts = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(node => node.getClientRects().length && !node.closest('svg') && !getComputedStyle(node).fontFamily.startsWith('"RD Departure Mono"')).map(node => node.className || node.tagName));
  assert.deepEqual(otherFonts,[],'every visible element uses the pixel font');
  pass('CDP confirms Departure Mono glyphs; no visible element uses another font',renderedFonts);
  await cdp.detach();
  if (!fontsOnly) {
  assert.equal(await page.locator('.sidebar-foot,.analysis-sidebar-foot,.analysis-card-number,.analysis-eyebrow').count(),0);
  assert.doesNotMatch(await page.locator('body').innerText(),/WHISPER\s*·\s*LOCAL|Sin archivos|EXPLORADOR DE TEXTO/);
  pass('Removed footers, duplicate eyebrow and decorative numbering');
  const metrics = async selector => page.locator(selector).evaluate(node => {const css=getComputedStyle(node),rect=node.getBoundingClientRect();return{width:rect.width,paddingTop:css.paddingTop,paddingLeft:css.paddingLeft,paddingRight:css.paddingRight,background:css.backgroundColor};});
  const transcribeSidebar = await metrics('.sidebar');
  assert.equal(transcribeSidebar.width,304);assert.equal(transcribeSidebar.paddingTop,'24px');assert.equal(transcribeSidebar.paddingLeft,'24px');
  await page.waitForTimeout(1700);
  assert.deepEqual(await monoSizes(),[],'transcribe mono sizes');
  const spriteIds = ['i-transcribe','i-analysis','i-moon','i-sun','i-folder-plus','i-close','i-download','i-pause','i-play','i-chevron-down','i-plus','i-search','i-file','i-chart','i-timeline','i-reset','i-zoom-in','i-zoom-out','i-pan'];
  const symbols = await page.evaluate(ids => ids.filter(id => {const node=document.querySelector(`#rd-sprite symbol#${id}`);return !node || node.getAttribute('viewBox')!=='0 0 24 24' || node.getAttribute('shape-rendering')!=='crispEdges';}),spriteIds);
  assert.deepEqual(symbols,[],'missing or malformed sprite symbols');pass('Sprite has every pixel icon symbol',spriteIds.length);
  const badIcons = scope => page.evaluate(scope => [...document.querySelectorAll(scope)].filter(svg => svg.id !== 'rd-logo' && svg.id !== 'rd-sprite' && svg.id !== 'js-plotly-tester' && !svg.closest('.deco') && !svg.closest('#rd-sprite') && !svg.closest('.js-plotly-plot') && svg.getClientRects().length).map(svg => {
    const uses=svg.querySelectorAll('use'),href=uses[0]?.getAttribute('href')||'',rect=svg.getBoundingClientRect();
    const ok=uses.length===1 && href.startsWith('#i-') && document.querySelector('#rd-sprite symbol'+href) && [24,48].includes(Math.round(rect.width)) && Math.round(rect.width)===Math.round(rect.height);
    return ok ? null : (svg.outerHTML.slice(0,80)+' '+rect.width+'x'+rect.height);
  }).filter(Boolean),scope);
  assert.deepEqual(await badIcons('.topbar svg, #transcribe-panel svg'),[],'transcribe icons');pass('Top bar and Transcribe icons use the sprite at 24/48px');
  await page.screenshot({path:path.join(output,'transcribe-empty-light.png')});
  const indicatorBefore = await page.locator('.tab-indicator').evaluate(node => ({x:node.getBoundingClientRect().x,transition:getComputedStyle(node).transitionProperty,duration:getComputedStyle(node).transitionDuration}));
  assert.match(indicatorBefore.transition,/transform/);assert.ok(indicatorBefore.duration.split(',').some(value => parseFloat(value)>0));
  await page.locator('#tab-analysis').click();
  const panelMotion = await page.evaluate(() => ({parts:document.querySelector('#analysis-panel').getAnimations({subtree:true}).filter(a => a.effect.getTiming().iterations !== Infinity).length,traces:document.querySelectorAll('.trace').length,indicator:getComputedStyle(document.querySelector('.tab-indicator')).transitionTimingFunction}));
  assert.ok(panelMotion.parts>3 && panelMotion.traces>0 && panelMotion.indicator.includes('steps('),JSON.stringify(panelMotion));
  pass('Tab change assembles the panel cell by cell',panelMotion);
  await settle();
  assert.deepEqual(await metrics('.analysis-sidebar'),transcribeSidebar);
  assert.ok(await page.locator('.tab-indicator').evaluate(node => node.getBoundingClientRect().x)>indicatorBefore.x+50);
  pass('Shared desktop sidebar geometry and moving tab indicator',transcribeSidebar);
  assert.equal(await page.locator('.analysis-heading h1').evaluate(node=>getComputedStyle(node).fontSize),'22px');
  assert.deepEqual(await monoSizes(),[],'analysis mono sizes');pass('Departure Mono only at 11px or 22px in both tabs');
  await page.screenshot({path:path.join(output,'analysis-empty-light.png')});
  await page.setViewportSize({width:1024,height:900});await settle();
  const narrowAnalysis = await metrics('.analysis-sidebar');
  await page.locator('#tab-transcribe').click();await settle();
  const narrowTranscribe = await metrics('.sidebar');
  assert.deepEqual(narrowAnalysis,narrowTranscribe);assert.equal(narrowTranscribe.width,272);assert.equal(narrowTranscribe.paddingLeft,'20px');
  pass('Shared layout at 1024px',narrowTranscribe);
  await page.setViewportSize({width:1440,height:1000});await settle();
  await page.locator('#language-button').click();
  const menuMotion = await page.locator('#language-popover').evaluate(node=>({name:getComputedStyle(node).animationName,duration:getComputedStyle(node).animationDuration}));
  assert.ok(menuMotion.name.includes('menu-in'));assert.ok(parseFloat(menuMotion.duration)>0);pass('Language disclosure uses productive motion',menuMotion);
  await page.keyboard.press('Escape');

  const job = {id:'visual-stream',name:'Entrevista.wav',status:'processing',model:'tiny',language:'en',detected_language:'en',stage:'Transcribiendo',progress:15,speed:1.6,eta:5,duration:9,segments:[{start:0,end:3,text:'This is a test of local transcription.'}],preview:'The forest'};
  const emit = snapshot => page.evaluate(value=>window.__qaEmit(value),snapshot);
  await emit({jobs:[job],current_id:job.id});
  await page.waitForFunction(()=>document.querySelectorAll('.segment').length===2);
  await page.evaluate(()=>{window.__qaFinal=document.querySelector('.segment:not(.provisional)');window.__qaFinalText=window.__qaFinal.querySelector('p').firstChild;window.__qaPreview=document.querySelector('.segment.provisional');});
  await emit({jobs:[{...job,progress:25,preview:'The forest is full of life.'}],current_id:job.id});
  const retainedPreview = await page.evaluate(()=>({final:window.__qaFinal===document.querySelector('.segment:not(.provisional)'),text:window.__qaFinalText===document.querySelector('.segment:not(.provisional) p').firstChild,preview:window.__qaPreview===document.querySelector('.segment.provisional'),content:document.querySelector('.segment.provisional p').textContent}));
  assert.deepEqual(retainedPreview,{final:true,text:true,preview:true,content:'The forest is full of life.'});
  const completed = {...job,status:'completed',stage:'Completado',progress:100,eta:0,preview:'',segments:[...job.segments,{start:3,end:5,text:'The forest is full of life.'},{start:5,end:9,text:'We can search for words and read their context.'}]};
  await emit({jobs:[completed],current_id:null});
  assert.ok(await page.evaluate(()=>window.__qaFinal===document.querySelector('.segment:not(.provisional)') && !window.__qaPreview.isConnected));
  assert.equal(await page.locator('.segment').count(),3);pass('Streaming keeps finalized and provisional nodes while updating text',retainedPreview);
  assert.equal(await page.locator('#queue-count').textContent(),'1');
  await settle();
  const smallTargets = await page.evaluate(() => [...document.querySelectorAll('.topbar button, .topbar [role=button], .topbar [role=tab], .topbar input, #transcribe-panel button, #transcribe-panel [role=button], #transcribe-panel [role=tab], #transcribe-panel input, .format-options input')]
    .map(node => node.matches('.format-options input') ? node.nextElementSibling : node)
    .filter(node => node.getClientRects().length && !(node.matches('input') && node.type === 'checkbox'))
    .map(node => ({node:node.id || node.className || node.tagName, height:node.getBoundingClientRect().height})).filter(item => item.height < 40));
  assert.deepEqual(smallTargets,[],'touch targets under 40px');
  const surfaces = await page.evaluate(() => ['.transcript-paper','.primary-button','.model','.select-button','.toast'].map(selector => {const css=getComputedStyle(document.querySelector(selector));return {selector,radius:css.borderRadius,shadow:css.boxShadow,image:css.backgroundImage};}).filter(x => !['0px','2px'].includes(x.radius) || x.shadow !== 'none' || x.image !== 'none'));
  assert.deepEqual(surfaces,[],'flat surfaces');
  pass('Transcribe targets >= 40px and flat surfaces (radius 0/2, no shadow, no gradient)');
  await page.screenshot({path:path.join(output,'transcribe-light.png')});
  const scan = () => page.evaluate(() => {const css=getComputedStyle(document.body,'::after');return {opacity:css.opacity,events:css.pointerEvents};});
  assert.deepEqual(await scan(),{opacity:'0.03',events:'none'});
  await page.evaluate(() => {window.__themeAnimations=[];const original=Element.prototype.animate;Element.prototype.animate=function(k,o){if(o?.pseudoElement)window.__themeAnimations.push([o.pseudoElement,o.duration]);return original.call(this,k,o);};});
  await page.locator('#theme-toggle').click();await settle();
  const crt = await page.evaluate(() => ({animations:window.__themeAnimations,theme:document.documentElement.dataset.theme,stored:localStorage.getItem('rd-theme')}));
  assert.ok(crt.animations.length===1 && crt.animations[0][0]==='::view-transition-new(root)' && crt.animations[0][1]<=450 && crt.theme==='dark' && crt.stored==='dark',JSON.stringify(crt));
  assert.deepEqual(await scan(),{opacity:'0.06',events:'none'});
  pass('Theme rolls in band by band within 450 ms and static scanlines per theme',crt);
  await page.screenshot({path:path.join(output,'transcribe-dark.png')});

  await page.locator('#tab-analysis').click();
  await page.locator('.analysis-open').click();
  await page.locator('.analysis-file').nth(1).waitFor();
  await page.locator('#analysis-keyword').fill('bosque');
  await page.waitForFunction(()=>document.querySelectorAll('.analysis-result').length>0);
  const plotTypography = await page.locator('.analysis-timeline').first().evaluate(plot=>({font:plot.layout.font.family,size:plot.layout.font.size,computed:getComputedStyle(plot.querySelector('.xtick text')).fontFamily,tickSize:getComputedStyle(plot.querySelector('.xtick text')).fontSize}));
  assert.equal(plotTypography.font,family);assert.ok(plotTypography.computed.startsWith('"RD Departure Mono"'),plotTypography.computed);assert.equal(plotTypography.tickSize,'11px');assert.equal(plotTypography.size,11);pass('Plotly uses the shared body font at readable size',plotTypography);
  assert.deepEqual(await badIcons('svg'),[],'analysis icons');
  await settle();await page.screenshot({path:path.join(output,'analysis-dark.png')});
  await page.locator('#theme-toggle').click();await settle();
  const plotTheme = await page.evaluate(() => ({paper:document.querySelector('.analysis-timeline').layout.paper_bgcolor.toLowerCase(),panel:getComputedStyle(document.documentElement).getPropertyValue('--panel').trim().toLowerCase()}));
  assert.equal(plotTheme.paper,plotTheme.panel);pass('Plotly redraws from the theme tokens',plotTheme);
  await page.screenshot({path:path.join(output,'analysis-light.png')});
  await page.locator('.analysis-main').evaluate(node=>{node.scrollTop=700});await settle();await page.screenshot({path:path.join(output,'analysis-context-light.png')});
  await page.locator('.analysis-main').evaluate(node=>{node.scrollTop=0});
  await page.locator('#analysis-keyword').fill('río');await page.waitForFunction(()=>document.querySelectorAll('.analysis-result').length===6);
  assert.equal(await page.locator('.analysis-result-enter').count(),0);pass('Typing does not reanimate all search results');

  // Keyboard walk: every focused element shows a 2px solid --action outline offset 2px, below the top bar.
  const walk = async () => {
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0,0); });
    const seen = [], bad = [];
    let first = null;
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const probe = document.createElement('i'); probe.style.color = 'var(--action)'; document.body.append(probe);
        const action = getComputedStyle(probe).color; probe.remove();
        const target = el.matches('.format-options input') ? el.nextElementSibling : el;
        const css = getComputedStyle(target), rect = target.getBoundingClientRect(), bar = document.querySelector('.topbar').getBoundingClientRect();
        const key = el.id || el.className || el.tagName;
        const visible = target.getClientRects().length > 0 && css.visibility !== 'hidden';
        return {key, isFirst: el === window.__walkFirst, set: !window.__walkFirst && (window.__walkFirst = el) && true, visible,
          ok: !visible || (css.outlineStyle === 'solid' && css.outlineWidth === '2px' && css.outlineColor === action && css.outlineOffset === '2px' && (el.closest('.topbar') || (rect.top >= bar.bottom - 1 && rect.bottom <= innerHeight + 1))),
          detail: [css.outlineStyle, css.outlineWidth, css.outlineColor, action, css.outlineOffset, Math.round(rect.top), Math.round(rect.bottom), Math.round(bar.bottom)]};
      });
      if (!info) continue;
      if (info.isFirst) break;
      seen.push(info.key);
      if (!info.ok) bad.push(info);
    }
    await page.evaluate(() => { window.__walkFirst = null; });
    return {seen, bad};
  };
  const analysisWalk = await walk();
  await page.locator('#tab-transcribe').click(); await settle();
  const transcribeWalk = await walk();
  assert.deepEqual([...analysisWalk.bad, ...transcribeWalk.bad], [], 'focus ring');
  assert.ok(analysisWalk.seen.length > 5 && transcribeWalk.seen.length > 5, JSON.stringify({analysisWalk, transcribeWalk}));
  pass('Keyboard focus ring on every stop in both tabs', {analysis: analysisWalk.seen.length, transcribe: transcribeWalk.seen.length});
  await page.locator('#tab-analysis').click(); await settle();
    await page.locator('#tab-transcribe').click();await settle();
  assert.deepEqual(await badIcons('svg'),[],'transcribe icons with documents loaded');pass('Every icon in both tabs uses the sprite at 24/48px');
  await page.locator('#language-button').click();

  // Model cells: nothing chosen, a download button per cell, real numbers while downloading.
  const cell = model => page.evaluate(model => {const row=document.querySelector(`[data-row="${model}"]`),q=s=>row.querySelector(s);return {disabled:q('.model').disabled,get:!q('.model-get').hidden,progress:!q('.model-progress').hidden,text:q('.model-progress').textContent};},model);
  await page.keyboard.press('Escape');
  const models = {tiny:{status:'ready',size:'75 MB'},small:{status:'missing',size:'484 MB'},medium:{status:'downloading',size:'1.5 GB',downloaded:500e6,total:1500e6,speed:2e6,eta:500}};
  assert.equal(await page.locator('.model.selected').count(),0,'no model comes selected');
  await page.evaluate(v => window.__qaEmit(v),{jobs:[{id:'w',name:'espera.wav',status:'waiting',stage:'Esperando modelo',progress:0,segments:[]}],current_id:null,models});
  const [ready,missing,busy] = [await cell('tiny'),await cell('small'),await cell('medium')];
  assert.ok(!ready.disabled && !ready.get && !ready.progress,JSON.stringify(ready));
  assert.ok(missing.disabled && missing.get && !missing.progress,JSON.stringify(missing));
  assert.ok(busy.disabled && !busy.get && busy.progress && /33%/.test(busy.text) && /2\.00 MB\/s/.test(busy.text) && /00:08:20/.test(busy.text),JSON.stringify(busy));
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.model-row')].filter(row => row.scrollWidth > row.clientWidth).length);
  assert.equal(overflow,0,'download details fit inside the cell');
  assert.equal(await page.locator('#start-jobs').isDisabled(),true,'cannot start without choosing a model');
  await page.locator('[data-get="small"]').click();
  assert.equal(await page.evaluate(() => window.__qaDownload),'small');
  await page.locator('[data-model="tiny"]').click();
  assert.equal(await page.locator('#start-jobs').isDisabled(),false);
  assert.equal(await page.locator('#pause-job').isDisabled(),true,'a waiting file has nothing to pause');
  assert.equal(await page.locator('#hud-clock,#motion-toggle,.stripe-wave,.roll,.radar').count(),0,'removed elements');
  pass('Model cells: none chosen, per-cell download with percent, speed and time, explicit start');
  const specimen = await context.newPage();
  specimen.on('pageerror',error => errors.push('specimen: '+error.message));
  await specimen.goto('http://127.0.0.1:8767/web/specimen.html');
  await specimen.waitForFunction(() => window.__specimenReady);
  const specimenIcons = await specimen.evaluate(() => [...document.querySelectorAll('#rd-sprite symbol')].map(symbol => [...document.querySelectorAll(`.specimen-icon[data-symbol="${symbol.id}"]`)].map(node => Math.round(node.getBoundingClientRect().width)).sort((a,b)=>a-b).join(',')));
  assert.ok(specimenIcons.length >= 19 && specimenIcons.every(sizes => sizes === '24,48'),JSON.stringify(specimenIcons));
  await specimen.evaluate(() => document.fonts.ready);
  await specimen.screenshot({path:path.join(output,'specimen-light.png'),fullPage:true});
  await specimen.locator('#specimen-theme').click();await specimen.waitForTimeout(400);
  await specimen.screenshot({path:path.join(output,'specimen-dark.png'),fullPage:true});
  await specimen.close();
  pass('Specimen shows every symbol at 24 and 48px in both themes',specimenIcons.length);
  }
  assert.deepEqual(errors,[]);
} catch(error) {errors.push(error.stack || error.message);console.error(error.message);process.exitCode=1;}
finally {
  await context?.close();
  if (recording) {
    try {await recording.saveAs(path.join(output,'design-motion.webm'));}
    catch(error) {errors.push('Video recording: '+error.message);process.exitCode=1;}
  }
  await browser?.close();await new Promise(resolve=>server.close(resolve));
  const result={mode:'Source UI with simulated browser adapter; no inference',checks,errors,passed:errors.length===0};
  await fs.writeFile(path.join(output,fontsOnly?'font-results.json':'design-results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}
