import {typeOn, decode, assemble, themeSwitch, reticle} from './motion.js';
const $ = selector => document.querySelector(selector);
const labels = {waiting:'en espera', pending:'pendiente', processing:'procesando', paused:'en pausa', completed:'completado', cancelled:'cancelado', error:'error'};
let bridge, config, state = {jobs:[], current_id:null}, selectedId = null;
let model = null, language = '', lastQueueKey = '', toastTimer, toastAnimation;
let renderedJobId, renderedSegments = [], previewNode;
const knownJobIds = new Set();
const theme = localStorage.getItem('rd-theme') || 'light';
document.documentElement.dataset.theme = theme;

function setText(el, text) {
  const before = el.textContent;
  if (before === text) return;
  el.textContent = text;
  if (before.replace(/\d+/g, '') !== text.replace(/\d+/g, '')) typeOn(el);
}
function notify(message) {
  const toast = $('#toast');
  clearTimeout(toastTimer);
  toastAnimation?.cancel();
  toast.textContent = message;
  toast.hidden = false;
  toastAnimation = toast.animate([{opacity:0, translate:'0 8px'}, {opacity:1, translate:'0 0'}], {duration:240, easing:'cubic-bezier(0,0,.38,.9)'});
  toastTimer = setTimeout(async () => {
    const animation = toast.animate([{opacity:1}, {opacity:0}], {duration:140});
    toastAnimation = animation;
    try { await animation.finished; } catch { return; }
    toast.hidden = true;
  }, 6500);
}
// Vite hoists the bundled module above the deferred analysis.js; wait for it when that happens.
if (!window.RDAnalysis) await new Promise(resolve => document.querySelector('script[src$="analysis.js"]').addEventListener('load', resolve, {once:true}));
const analysis = window.RDAnalysis.mount({
  root:$('#analysis-root'), openFiles:() => bridge?.openAnalysis(),
  saveText:(name,text) => bridge?.saveText(name,text),
  saveImage:(name,data) => bridge?.saveImage(name,data),
  saveChart:(name,figure) => bridge?.saveChart(name, typeof figure === 'string' ? figure : JSON.stringify(figure)), notify
});
analysis.setTheme(theme);
document.querySelector('.analysis-empty-glyph').replaceWith(reticle());
const useIcon = id => `<svg class="icon" aria-hidden="true" focusable="false"><use href="#${id}"/></svg>`;
function updateThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#theme-toggle use').setAttribute('href', dark ? '#i-sun' : '#i-moon');
  $('#theme-toggle').title = dark ? 'Modo día' : 'Modo noche';
  $('#theme-toggle').setAttribute('aria-label', dark ? 'Cambiar a modo día' : 'Cambiar a modo noche');
}
updateThemeButton();
$('#theme-toggle').onclick = () => themeSwitch(() => {
  const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('rd-theme', theme);
  analysis.setTheme(theme);
  updateThemeButton();
});
const tabNames = ['transcribe','analysis'];
function activateTab(name) {
  if ($('#tab-'+name).getAttribute('aria-selected') === 'true') return;
  $('.tabs').style.setProperty('--active-index', tabNames.indexOf(name));
  for (const other of tabNames) {
    const active = name === other;
    const tab = $('#tab-'+other);
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $('#'+other+'-panel').hidden = !active;
  }
  assemble($('#'+name+'-panel'), {pace:.6});
  if (name === 'analysis') requestAnimationFrame(() => analysis.resize());
}
tabNames.forEach((name,index) => {
  const tab = $('#tab-'+name);
  tab.onclick = () => activateTab(name);
  tab.onkeydown = event => {
    const keys = {ArrowLeft:1-index, ArrowRight:1-index, Home:0, End:1};
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = $('#tab-'+tabNames[keys[event.key]]);
    next.click(); next.focus();
  };
});
document.querySelectorAll('.model').forEach(button => button.onclick = () => {
  model = button.dataset.model;
  document.querySelectorAll('.model').forEach(option => {
    option.classList.toggle('selected', option === button);
    option.setAttribute('aria-pressed', String(option === button));
  });
  renderStart();
});
document.querySelectorAll('.model-get').forEach(button => button.onclick = () => bridge?.downloadModel(button.dataset.get));
document.querySelectorAll('.model-cancel').forEach(button => button.onclick = () => bridge?.cancelDownload(button.dataset.cancel));
const megabytes = bytes => bytes >= 1e9 ? (bytes/1e9).toFixed(2)+' GB' : Math.round(bytes/1e6)+' MB';
function renderModels() {
  document.querySelectorAll('.model-row').forEach(row => {
    const name = row.dataset.row, info = state.models?.[name] || {status:'missing'}, active = info.status === 'downloading' || info.status === 'verifying';
    row.dataset.status = info.status;
    const pick = row.querySelector('.model');
    pick.disabled = info.status !== 'ready';
    pick.title = info.status === 'ready' ? '' : 'Descarga este modelo para poder usarlo';
    pick.querySelector('small').textContent = name+(info.size ? ' · '+info.size : '');
    row.querySelector('.model-get').hidden = info.status !== 'missing';
    row.querySelector('.model-progress').hidden = !active;
    const error = row.querySelector('.model-error');
    error.hidden = !info.error; error.textContent = info.error || '';
    if (!active) return;
    const percent = info.total ? Math.floor(100*info.downloaded/info.total) : null;
    row.querySelector('.model-percent').textContent = percent == null ? '—' : percent+'%';
    row.querySelector('.model-bar i').style.width = (percent || 0)+'%';
    row.querySelector('.model-speed').textContent = info.status === 'verifying' ? 'Comprobando' : info.speed ? (info.speed/1e6).toFixed(2)+' MB/s' : info.total ? 'Calculando' : 'Conectando';
    row.querySelector('.model-eta').textContent = info.eta != null ? 'Quedan '+time(info.eta) : '';
    row.querySelector('.model-size').textContent = info.total ? megabytes(info.downloaded)+' / '+megabytes(info.total) : '';
  });
}
function renderStart() {
  const waiting = state.jobs.filter(job => job.status === 'waiting').length;
  const ready = model && state.models?.[model]?.status === 'ready';
  $('#start-jobs').disabled = !waiting || !ready;
  $('#start-hint').textContent = !model ? (Object.values(state.models || {}).some(info => info.status === 'ready') ? 'Elige un modelo.' : 'Descarga un modelo para empezar.') : !waiting ? 'Abre uno o varios archivos.' : '';
}
function closeLanguages() {
  $('#language-popover').hidden = true;
  $('#language-button').setAttribute('aria-expanded','false');
}
$('#language-button').onclick = () => {
  const open = $('#language-popover').hidden;
  $('#language-popover').hidden = !open;
  $('#language-button').setAttribute('aria-expanded', String(open));
  if (open) { $('#language-search').value = ''; renderLanguages(); $('#language-search').focus(); }
};
document.addEventListener('click', event => { if (!event.target.closest('.language-block')) closeLanguages(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#language-popover').hidden) { closeLanguages(); $('#language-button').focus(); }
});
function norm(text) { return text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
function renderLanguages() {
  const host = $('#language-options');
  host.replaceChildren();
  const search = norm($('#language-search').value);
  const languages = [['','Detectar idioma'], ...Object.entries(config?.languages || {}).sort((a,b) => a[1].localeCompare(b[1],'es'))];
  for (const [code,label] of languages) {
    if (!norm(label+' '+code).includes(search)) continue;
    const option = document.createElement('button');
    option.className = 'language-option'; option.textContent = label; option.role = 'option';
    option.setAttribute('aria-selected', String(code === language));
    option.onclick = () => { language = code; $('#language-label').textContent = label; closeLanguages(); $('#language-button').focus(); };
    host.append(option);
  }
}
$('#language-search').oninput = renderLanguages;
function time(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  return [Math.floor(total/3600), Math.floor(total/60)%60, total%60].map(value => String(value).padStart(2,'0')).join(':');
}
function renderQueue() {
  const key = JSON.stringify([selectedId, state.jobs.map(job => [job.id,job.name,job.status])]);
  if (key === lastQueueKey) return;
  lastQueueKey = key;
  const focused = document.activeElement?.closest('.queue-item')?.dataset.id;
  const host = $('#queue'); host.replaceChildren();
  $('#queue-count').textContent = state.jobs.length;
  $('#queue-count').hidden = !state.jobs.length;
  for (const job of state.jobs) {
    const row = document.createElement('div');
    row.className = 'queue-item'+(job.id === selectedId ? ' selected' : '');
    row.tabIndex = 0; row.dataset.id = job.id; row.role = 'button';
    row.setAttribute('aria-label', job.name+', '+labels[job.status]);
    const icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = job.name.split('.').pop().slice(0,3).toUpperCase();
    const info = document.createElement('div'); info.className = 'file-info';
    const title = document.createElement('span'); title.className = 'file-name'; title.textContent = job.name; title.title = job.name;
    const status = document.createElement('span'); status.className = 'file-state '+job.status; status.textContent = labels[job.status] || job.status;
    info.append(title,status); row.append(icon,info);
    row.onclick = () => { selectedId = job.id; render(); };
    row.onkeydown = event => {
      if (event.target !== row) return;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectedId = job.id; render(); }
    };
    if (job.status === 'pending' || job.status === 'waiting') {
      const cancel = document.createElement('button'); cancel.className = 'queue-cancel'; cancel.innerHTML = useIcon('i-close'); cancel.title = 'Cancelar';
      cancel.setAttribute('aria-label','Cancelar '+job.name);
      cancel.onclick = event => { event.stopPropagation(); bridge.cancel(job.id); };
      row.append(cancel);
    }
    host.append(row);
  }
  if (focused) host.querySelector('[data-id="'+CSS.escape(focused)+'"]')?.focus();
}
function segmentNode(segment, provisional = false) {
  const row = document.createElement('div'); row.className = 'segment'+(provisional ? ' provisional' : '');
  const stamp = document.createElement('time'); stamp.textContent = provisional ? '···' : time(segment.start);
  const paragraph = document.createElement('p'); paragraph.textContent = segment.text;
  row.append(stamp,paragraph); return row;
}
function renderTranscript(job) {
  const host = $('#transcript'), segments = job?.segments || [];
  const changedJob = renderedJobId !== (job?.id || null);
  const nearBottom = changedJob || host.scrollTop+host.clientHeight >= host.scrollHeight-100;
  if (changedJob || segments.length < renderedSegments.length) {
    host.replaceChildren(); renderedSegments = []; previewNode = null;
    renderedJobId = job?.id || null;
  }
  host.classList.toggle('is-processing', job?.status === 'processing');
  if (segments.length || job?.preview) host.querySelector('.transcript-empty')?.remove();
  segments.forEach((segment,index) => {
    let row = renderedSegments[index];
    if (!row) {
      row = segmentNode(segment); renderedSegments.push(row);
      host.insertBefore(row, previewNode || null);
      if (!changedJob) decode(row);
    } else {
      if (row.lastChild.textContent !== segment.text) row.lastChild.textContent = segment.text;
      const stamp = time(segment.start);
      if (row.firstChild.textContent !== stamp) row.firstChild.textContent = stamp;
    }
  });
  if (job?.preview) {
    if (!previewNode) { previewNode = segmentNode({text:job.preview}, true); host.append(previewNode); }
    else if (previewNode.lastChild.textContent !== job.preview) previewNode.lastChild.textContent = job.preview;
  } else if (previewNode) { previewNode.remove(); previewNode = null; }
  if (!segments.length && !job?.preview && !host.querySelector('.transcript-empty')) {
    const empty = document.createElement('div'); empty.className = 'transcript-empty';
    const hint = document.createElement('p'); hint.className = 'transcript-hint'; hint.textContent = 'Abre un audio o un video para empezar.';
    empty.append(reticle(), hint); host.append(empty);
  }
  const hint = host.querySelector('.transcript-hint');
  if (hint) hint.textContent = job?.status === 'waiting' ? 'Elige un modelo y pulsa Transcribir.' : job?.status === 'processing' ? 'Escuchando…' : 'Abre un audio o un video para empezar.';
  if (nearBottom) host.scrollTop = host.scrollHeight;
}
const pauseIcon = useIcon('i-pause');
const resumeIcon = useIcon('i-play');
function render() {
  renderQueue();
  renderModels();
  renderStart();
  const job = state.jobs.find(item => item.id === selectedId), segments = job?.segments || [];
  setText($('#current-name'), job?.name || 'Transcripción');
  $('#segment-count').textContent = segments.length+' '+(segments.length === 1 ? 'segmento' : 'segmentos');
  $('#segment-count').hidden = !segments.length;
  const status = job ? labels[job.status] || job.status : 'en espera';
  setText($('#paper-status'), status[0].toUpperCase()+status.slice(1));
  const lang = job?.detected_language || job?.language;
  $('#paper-language').textContent = lang ? config?.languages?.[lang] || lang : '';
  renderTranscript(job);
  $('#transcript-position').textContent = time(segments.at(-1)?.end);
  setText($('#progress-stage'), job?.error || job?.stage || 'En espera');
  const progress = job?.status === 'waiting' ? null : job?.progress;
  $('#progress-percent').textContent = progress == null ? '—' : Math.round(progress)+'%';
  $('#progress-fill').style.width = Math.floor((progress || 0) / 5) * 5+'%';
  $('#progress-track').classList.toggle('indeterminate', job?.status === 'processing' && progress == null);
  if (progress == null) $('#progress-track').removeAttribute('aria-valuenow');
  else $('#progress-track').setAttribute('aria-valuenow', Math.round(progress));
  $('#speed').textContent = job?.speed ? job.speed.toFixed(2)+'×' : '—';
  $('#eta').textContent = job?.eta != null ? time(job.eta) : '—';
  $('#pause-job').disabled = !job || !['processing','paused'].includes(job.status);
  const paused = job?.status === 'paused';
  if ($('#pause-job').dataset.paused !== String(paused)) {
    $('#pause-job').dataset.paused = String(paused);
    $('#pause-job').innerHTML = (paused ? resumeIcon : pauseIcon)+'<span>'+(paused ? 'Reanudar' : 'Pausar')+'</span>';
  }
  $('#cancel-job').disabled = !job || !['processing','paused','pending','waiting'].includes(job.status);
  $('#export-job').disabled = !segments.length || !($('#format-txt').checked || $('#format-srt').checked);
}
$('#open-media').onclick = () => bridge?.openMedia('',language);
$('#start-jobs').onclick = () => { if (model) bridge?.startJobs(model,language); };
$('#pause-job').onclick = () => { const job = state.jobs.find(item => item.id === selectedId); if (job) bridge[job.status === 'paused' ? 'resume' : 'pause'](job.id); };
$('#cancel-job').onclick = () => bridge?.cancel(selectedId);
$('#export-job').onclick = () => { const formats = ['txt','srt'].filter(format => $('#format-'+format).checked); if (formats.length) bridge?.exportJob(selectedId,JSON.stringify(formats)); };
for (const format of ['txt','srt']) $('#format-'+format).onchange = render;
render();
async function connect() {
  if (window.qt?.webChannelTransport) {
    await new Promise((resolve,reject) => { const script = document.createElement('script'); script.src = 'qrc:///qtwebchannel/qwebchannel.js'; script.onload = resolve; script.onerror = reject; document.head.append(script); });
    bridge = await new Promise(resolve => new QWebChannel(qt.webChannelTransport, channel => resolve(channel.objects.native)));
  } else {
    const {createBrowserBridge} = await import('./browser-engine.js'); bridge = await createBrowserBridge();
  }
  config = await new Promise(resolve => bridge.config(value => resolve(typeof value === 'string' ? JSON.parse(value) : value)));
  bridge.stateChanged.connect(value => {
    const previous = state.current_id;
    state = typeof value === 'string' ? JSON.parse(value) : value;
    if (state.current_id && selectedId === previous) selectedId = state.current_id;
    if (!selectedId || !state.jobs.some(job => job.id === selectedId)) selectedId = state.current_id || state.jobs[0]?.id;
    render();
  });
  bridge.documentsLoaded.connect(value => { analysis.addDocuments(typeof value === 'string' ? JSON.parse(value) : value); requestAnimationFrame(() => assemble($('.analysis-main'), {pace:.6})); });
  bridge.notified.connect(notify); renderLanguages(); bridge.ready();
}
connect().catch(error => { console.error(error); notify('No se pudo iniciar el motor: '+error.message); });
