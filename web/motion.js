// Motion language taken from the refes/ videos: lines that draw themselves, shapes filled band by
// band, a phosphor flash that settles, a rolling refresh. No dependencies.
// Deliberately ignores prefers-reduced-motion: the animations always run.
const root = document.documentElement;
const stored = key => { try { return localStorage.getItem(key); } catch { return null; } };
root.dataset.theme = stored('rd-theme') || 'light';

const token = name => getComputedStyle(root).getPropertyValue(name).trim();
const clamp = t => Math.max(0, Math.min(1, t));
const easeOut = t => 1 - (1 - t) ** 3;
const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs) => {
  const node = document.createElementNS(SVG, name);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  return node;
};

// Film grain: coloured pixel noise, moved as one compositor layer (see .grain in styles.css).
function makeGrain() {
  const size = 256, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'), image = ctx.createImageData(size, size), data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.random() * 256; data[i + 1] = Math.random() * 256; data[i + 2] = Math.random() * 256;
    data[i + 3] = Math.random() * 256;
  }
  ctx.putImageData(image, 0, 0);
  root.style.setProperty('--grain', `url(${canvas.toDataURL()})`);
}

// Empty state: the flight-path marker from the head-up display in refes/i1.
export function reticle() {
  const svg = svgEl('svg', {class: 'reticle deco', viewBox: '0 0 120 32', 'aria-hidden': 'true'});
  const marker = svgEl('g', {class: 'reticle-marker'});
  marker.append(svgEl('circle', {cx: 60, cy: 18, r: 6}), svgEl('line', {x1: 28, y1: 18, x2: 54, y2: 18}), svgEl('line', {x1: 66, y1: 18, x2: 92, y2: 18}), svgEl('line', {x1: 60, y1: 12, x2: 60, y2: 4}));
  svg.append(svgEl('line', {x1: 0, y1: 18, x2: 20, y2: 18, class: 'reticle-horizon'}), svgEl('line', {x1: 100, y1: 18, x2: 120, y2: 18, class: 'reticle-horizon'}), marker);
  return svg;
}

const running = new Set();
const track = (animation, onEnd) => {
  running.add(animation);
  const end = () => { running.delete(animation); onEnd?.(); };
  animation.finished.then(end, end);
  return animation;
};
const hidden = {opacity: 0};

// A frame draws itself along its perimeter, followed by a fainter echo that closes in on it.
function trace(el, delay, duration) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const svg = svgEl('svg', {class: 'trace deco', width: r.width + 16, height: r.height + 16, style: `left:${r.left - 8}px;top:${r.top - 8}px`, 'aria-hidden': 'true'});
  const rect = (inset, extra) => svgEl('rect', {x: 8 - inset, y: 8 - inset, width: r.width + inset * 2, height: r.height + inset * 2, pathLength: 1, class: 'trace-line' + extra});
  const line = rect(0, ''), echo = rect(5, ' echo');
  svg.append(echo, line);
  document.body.append(svg);
  const draw = (node, wait) => track(node.animate([{strokeDashoffset: 1}, {strokeDashoffset: 0}], {duration, delay: wait, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'both'}));
  draw(line, delay);
  draw(echo, delay + 60);
  track(svg.animate([{opacity: 1}, {opacity: 1, offset: .75}, {opacity: 0}], {duration: duration + 320, delay, fill: 'both'}), () => svg.remove());
}

// Content warms up like a phosphor: flicker and overexposure, filled band by band.
function fill(el, delay, duration) {
  el.style.setProperty('--d', delay + 'ms');
  el.style.setProperty('--t', duration + 'ms');
  el.classList.add('band-in');
  el.addEventListener('animationend', event => { if (event.target === el && event.animationName === 'band-in') el.classList.remove('band-in'); });
  track(el.animate([
    {opacity: 0, filter: 'brightness(2.4)'}, {opacity: .8, filter: 'brightness(2.2)', offset: .2},
    {opacity: .3, filter: 'brightness(1.6)', offset: .38}, {opacity: 1, filter: 'brightness(1.5)', offset: .55},
    {opacity: 1, filter: 'brightness(1)'}], {duration: duration + 120, delay, fill: 'backwards'}));
}

// A wipe with a straight edge, like the masks in the reference logos.
function wipe(el, delay, duration, from) {
  track(el.animate([{clipPath: from}, {clipPath: 'inset(0 0 0 0)'}], {duration, delay, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'backwards'}));
}

export function typeOn(el, delay = 0) {
  const n = Math.min(el.textContent.length, 40);
  if (!n) return;
  if (!delay) el.classList.add('typing');
  else setTimeout(() => el.classList.add('typing'), delay);
  const done = () => el.classList.remove('typing');
  track(el.animate([{clipPath: 'inset(0 100% 0 0)'}, {clipPath: 'inset(0 0 0 0)'}], {duration: Math.min(400, n * 16), delay, easing: `steps(${n}, end)`, fill: 'backwards'}), done);
}

// Selector → how it arrives. Order is the build order; items that are not visible are skipped.
const CHOREOGRAPHY = [
  ['.tabs', 'frame'], ['.topbar-tools .icon-button', 'frame'],
  ['.sidebar, .analysis-sidebar', 'drop'],
  ['.section-label, .analysis-section-label', 'line'],
  ['.model-row, .select-button, .primary-button, .analysis-open, .analysis-search, .analysis-file', 'frame'],
  ['.area-heading h1, .analysis-heading h1', 'type'],
  ['.transcript-paper, .analysis-empty, .analysis-card', 'frame'],
  ['.paper-top', 'line'], ['.reticle', 'rise'], ['.transcript-hint', 'type'], ['.paper-bottom', 'line'],
  ['.progress-top', 'line'], ['.progress-track', 'line'], ['.progress-ruler', 'line'], ['.metrics', 'line'],
  ['.quiet-button', 'fill'], ['.format-options label', 'fill'],
];

/** Assemble a part of the UI. Returns the total duration in ms. */
export function assemble(scope, {pace = 1, start = 0} = {}) {
  let at = start, last = start;
  for (const [selector, kind] of CHOREOGRAPHY) {
    const items = [...scope.querySelectorAll(selector)].filter(el => el.getClientRects().length);
    items.forEach(el => {
      const duration = 300 * pace;
      if (kind === 'frame') { trace(el, at, duration * 1.3); fill(el, at + duration * .55, duration); }
      else if (kind === 'fill') fill(el, at, duration);
      else if (kind === 'line') wipe(el, at, duration, 'inset(0 100% 0 0)');
      else if (kind === 'drop') wipe(el, at, duration * 1.4, 'inset(0 0 100% 0)');
      else if (kind === 'rise') { wipe(el, at, duration * 2, 'inset(100% 0 0 0)'); track(el.animate([{filter: 'brightness(2.6)', ...hidden}, {filter: 'brightness(1)', opacity: 1}], {duration: duration * 2, delay: at, fill: 'backwards'})); }
      else if (kind === 'type') typeOn(el, at);
      last = Math.max(last, at + duration * 2);
      at += 42 * pace;
    });
  }
  return last;
}

function skipAssembly() {
  for (const animation of running) animation.finish();
  document.querySelectorAll('.band-in').forEach(el => el.classList.remove('band-in'));
  document.querySelectorAll('.trace').forEach(el => el.remove());
  document.querySelectorAll('.typing').forEach(el => el.classList.remove('typing'));
}

// The logo, on black in both themes: a pen of light with a pale head traces the mark in one stroke,
// the phosphor settles, and the mark glides to the bar trailing two echoes while the interface
// assembles behind it.
// Centre lines of the mark, in the viewBox of assets/logo.svg. The pen goes lid, baseline, lower lid, tail.
const LID = [[12, 381], [20, 372], [50, 338], [85, 303], [125, 272], [170, 245], [220, 222], [285, 203], [350, 191], [418, 186], [482, 186], [557, 196], [621, 211], [677, 232], [721, 251], [763, 275], [797, 300], [846, 339], [880, 374], [892, 378]];
const BASE = [[10, 378]];
const LOWER = [[12, 382], [42, 415], [62, 440], [90, 470], [125, 492], [165, 511], [212, 523], [260, 526], [310, 527], [350, 521], [393, 509], [435, 491], [472, 469], [505, 445], [528, 424]];
const TAIL = [[1012, 652], [1012, 378]];
const PEN = [
  {at: 120, time: 1300, line: [...LID, ...BASE, ...LOWER, ...TAIL]},
  {at: 1130, time: 200, line: [[152, 186], [84, 100]]},
  {at: 1200, time: 200, line: [[448, 110], [448, 0]]},
  {at: 1270, time: 200, line: [[742, 186], [810, 100]]},
];
// The dark theme's colours, because the stage is dark in both themes.
const STAGE = '#0D1114', CYAN = '#8FD3E0', CREAM = '#FFF4D6';
const DRAWN = 1500, FLY = 1900, GLIDE = 1100, HEAD = 170;
const easeInOut = t => t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

function logoStage(canvas, logo, onFly, onDone) {
  const W = innerWidth, H = innerHeight, dpr = devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.lineJoin = ctx.lineCap = 'round';
  const ink = token('--ink');
  const [, , vbW, vbH] = logo.getAttribute('viewBox').split(' ').map(Number);
  const lw = Math.min(W * .34, 440), lh = lw * vbH / vbW, cx = W / 2, cy = H / 2, x0 = cx - lw / 2, y0 = cy - lh / 2;
  const shape = new Path2D(logo.querySelector('path').getAttribute('d'));
  const slot = logo.getBoundingClientRect();
  const trail = points => 'M' + points.map(point => point.join(' ')).join('L');
  const strokes = PEN.map(({at, time, line}) => ({at, time, path: new Path2D(trail(line)), length: line.slice(1).reduce((sum, point, i) => sum + Math.hypot(point[0] - line[i][0], point[1] - line[i][1]), 0)}));
  const glow = (amount, color) => { ctx.shadowBlur = amount * dpr; ctx.shadowColor = color; };
  let flying = false, stopped = false, t = 0, previous = performance.now();

  // A piece of the pen's line, from one distance along it to another.
  const segment = (stroke, from, to, color, alpha, width) => {
    from = Math.max(from, 0);
    if (to <= from) return;
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.setLineDash([to - from, stroke.length * 2]); ctx.lineDashOffset = -from;
    ctx.stroke(stroke.path);
  };
  const drawPen = () => {
    const heads = strokes.map(stroke => {
      const p = clamp((t - stroke.at) / stroke.time);
      return stroke.length * (p - Math.sin(p * Math.PI * 2) / 25);
    });
    strokes.forEach((stroke, i) => {
      if (!heads[i]) return;
      glow(16, CYAN); segment(stroke, 0, heads[i], CYAN, .9, 12);
      if (heads[i] < stroke.length) { glow(22, CREAM); segment(stroke, heads[i] - HEAD, heads[i], CREAM, 1, 16); }
    });
    ctx.shadowBlur = 0;
    // The mark itself is the mask, so the line has the mark's real width and ends.
    ctx.save();
    ctx.clip(shape, 'evenodd');
    strokes.forEach((stroke, i) => {
      if (!heads[i]) return;
      segment(stroke, 0, heads[i], CYAN, 1, 44);
      if (heads[i] < stroke.length) {
        segment(stroke, heads[i] - HEAD, heads[i], CREAM, 1, 44);
        segment(stroke, heads[i], heads[i] + 70, CYAN, .3, 44);
      }
    });
    ctx.restore();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    ctx.globalAlpha = 1;
  };
  const paint = (color, alpha) => { ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fill(shape, 'evenodd'); };
  const place = p => {
    const scale = (lw + (slot.width - lw) * p) / vbW;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, (x0 + (slot.left - x0) * p) * dpr, (y0 + (slot.top - y0) * p) * dpr);
  };

  const frame = now => {
    if (stopped) return;
    t += Math.min(now - previous, 50);
    previous = now;
    const glide = lag => easeInOut(clamp((t - FLY - lag) / GLIDE)), fly = glide(0);
    if (t > FLY && !flying) { flying = true; onFly(); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 1 - easeInOut(clamp((t - FLY) / (GLIDE * .9)));
    ctx.fillStyle = STAGE; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    if (t < DRAWN) {
      place(0);
      drawPen();
    } else {
      // Echoes trail the mark only while it travels.
      for (const [lag, alpha] of [[180, .15], [90, .3]]) {
        place(glide(lag));
        paint(CYAN, alpha * Math.sin(fly * Math.PI));
      }
      place(fly);
      glow((16 - 8 * clamp((t - DRAWN) / 400)) * (1 - fly), CYAN);
      paint(CYAN, 1 - fly);
      ctx.shadowBlur = 0;
      if (fly) paint(ink, fly);
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (t < FLY + GLIDE) requestAnimationFrame(frame);
    else onDone();
  };
  frame(previous);
  return () => { stopped = true; };
}

export function boot() {
  performance.mark('rd-boot-start');
  makeGrain();
  const splash = document.querySelector('.splash'), canvas = splash?.querySelector('canvas'), logo = document.querySelector('#rd-logo');
  const show = () => root.classList.remove('booting');
  if (!canvas || !logo) {
    show(); splash?.remove();
    performance.mark('rd-boot-end');
    return;
  }
  let finished = false, stop = () => {};
  const finish = skip => {
    if (finished) return;
    finished = true;
    removeEventListener('pointerdown', skipBoot, true);
    removeEventListener('keydown', skipBoot, true);
    stop(); show();
    if (skip) skipAssembly();
    document.querySelector('.splash')?.remove();
    logo.style.visibility = '';
    performance.mark('rd-boot-end');
  };
  const skipBoot = () => finish(true);
  addEventListener('pointerdown', skipBoot, true);
  addEventListener('keydown', skipBoot, true);
  logo.style.visibility = 'hidden';
  const whenLoaded = document.readyState === 'complete' ? Promise.resolve() : new Promise(resolve => addEventListener('load', resolve, {once: true}));
  whenLoaded.then(() => new Promise(requestAnimationFrame)).then(() => {
    if (finished) return;
    stop = logoStage(canvas, logo, () => {
      show();
      const body = document.querySelector('.topbar').parentElement;
      assemble(body, {start: 60});
    }, () => {
      logo.style.visibility = '';
      document.querySelector('.splash')?.remove();
      Promise.allSettled([...running].map(animation => animation.finished)).then(() => finish(false));
    });
    // The canvas paints the stage from its first frame; the splash's own black would hide the fade.
    splash.style.background = 'none';
  }).catch(error => {
    console.error(error);
    finish(true);
  });
}

const NOISE = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+=';

// Resolve a new transcript row left to right over 300 ms. The <p> keeps the final text the whole
// time (it is only made transparent); the noise lives in an overlay inserted between <time> and <p>.
export function decode(row) {
  const p = row.lastElementChild;
  const text = p.textContent;
  const layer = document.createElement('span');
  layer.className = 'decode-layer';
  layer.setAttribute('aria-hidden', 'true');
  row.insertBefore(layer, p);
  row.classList.add('decoding');
  const start = performance.now();
  const frame = now => {
    const t = Math.min(1, (now - start) / 300);
    const k = Math.floor(t * text.length);
    layer.dataset.resolved = k;
    layer.textContent = text.slice(0, k) + [...text.slice(k)].map(c => (c === ' ' ? ' ' : NOISE[Math.floor(Math.random() * NOISE.length)])).join('');
    if (t < 1) return requestAnimationFrame(frame);
    layer.remove();
    row.classList.remove('decoding');
  };
  frame(start);
}

// The new theme rolls down over the old one band by band, like a screen refresh.
export function themeSwitch(apply) {
  if (!document.startViewTransition) return apply();
  const transition = document.startViewTransition(apply);
  transition.ready.then(() => root.animate([
    {clipPath: 'inset(0 0 100% 0)', filter: 'brightness(1.4)'},
    {clipPath: 'inset(0 0 0 0)', filter: 'brightness(1)'},
  ], {duration: 420, easing: 'steps(14, end)', pseudoElement: '::view-transition-new(root)'}), () => {});
}
