// WCAG 2.x contrast gate for the theme tokens, plus a tokens-only literal scan.
// Exit 0 ok, 1 failing pair or stray literal, 2 token blocks or tokens missing.
import fs from 'node:fs';

const args = process.argv.slice(2);
const tokensOnly = args.includes('--tokens-only');
const files = args.flatMap((a, i) => (args[i - 1] === '--css' ? [a] : []));
if (!files.length) files.push('web/styles.css');

const SELECTORS = {light: ':root,:root[data-theme=light]', dark: ':root[data-theme=dark]'};
const TOKENS = 'paper panel ink muted accent-pastel action on-action data rule control danger'.split(' ');
const TEXT = 'ink/paper ink/panel muted/paper muted/panel action/paper action/panel on-action/action data/paper data/panel danger/paper danger/panel ink/accent-pastel'.split(' ');
const BOUNDARY = ['control/paper', 'control/panel'];

// Every rule as {selector, body, start, end} (offsets of the whole rule).
function rules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) out.push({selector: m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ''), body: m[2], start: m.index, end: re.lastIndex});
  return out;
}
const tokenRules = css => rules(css).filter(r => Object.values(SELECTORS).includes(r.selector));

if (tokensOnly) {
  let failed = false;
  for (const file of files) {
    const css = fs.readFileSync(file, 'utf8');
    const skip = tokenRules(css);
    const re = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/g;
    let m;
    while ((m = re.exec(css))) {
      if (skip.some(r => m.index >= r.start && m.index < r.end)) continue;
      const line = css.slice(0, m.index).split('\n').length;
      console.log(`FAIL ${file}:${line} ${m[0]}`);
      failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
}

const css = fs.readFileSync(files[0], 'utf8');
const found = tokenRules(css);
const themes = {};
for (const [theme, selector] of Object.entries(SELECTORS)) {
  const rule = found.find(r => r.selector === selector);
  if (!rule) { console.log(`Missing token block ${selector} in ${files[0]}`); process.exit(2); }
  themes[theme] = Object.fromEntries([...rule.body.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b)/g)].map(m => [m[1], m[2]]));
  const missing = TOKENS.filter(t => !themes[theme][t]);
  if (missing.length) { console.log(`Missing tokens in ${theme}: ${missing.join(' ')}`); process.exit(2); }
}

function luminance(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

let failed = false;
for (const theme of ['light', 'dark']) {
  for (const [pairs, min] of [[TEXT, 4.5], [BOUNDARY, 3.0]]) {
    for (const pair of pairs) {
      const [fg, bg] = pair.split('/');
      const value = ratio(themes[theme][fg], themes[theme][bg]);
      const ok = value >= min;
      failed ||= !ok;
      console.log(`${ok ? 'OK' : 'FAIL'} ${theme} ${pair} ${value.toFixed(2)} min ${min}`);
    }
  }
}
process.exit(failed ? 1 : 0);
