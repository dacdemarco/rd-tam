import { decodeText, nextChunkEnd, safeName, transcriptSrt, transcriptText, zipFiles } from './transcription-utils.js';

const decodeMedia = (...args) => import('./audio-decoder.js').then(module => module.decodeMedia(...args));

const terminal = new Set(['completed', 'cancelled', 'error']);
const MODEL_NAMES = ['tiny', 'small', 'medium'];
const flagKey = name => `rd-model-${name}`;
const readFlag = name => { try { return localStorage.getItem(flagKey(name)) === '1'; } catch { return false; } };
const writeFlag = name => { try { localStorage.setItem(flagKey(name), '1'); } catch { /* it would just ask to download again */ } };
async function cachedModels() {
  const found = new Set();
  try {
    const cache = await caches.open('transformers-cache');
    for (const request of await cache.keys()) for (const name of MODEL_NAMES) if (request.url.includes(`whisper-${name}/`)) found.add(name);
  } catch { /* no Cache API: the models will simply show as not downloaded */ }
  return found;
}
const abortError = () => new DOMException('Cancelado', 'AbortError');

function signal() {
  const callbacks = new Set();
  return { connect(fn) { callbacks.add(fn); return () => callbacks.delete(fn); }, emit(value) { for (const fn of callbacks) fn(value); } };
}

function selectFiles(accept, callback) {
  const input = document.createElement('input');
  input.type = 'file'; input.multiple = true; input.accept = accept;
  input.hidden = true; document.body.append(input);
  input.addEventListener('change', () => { const files = [...input.files]; input.remove(); callback(files); }, { once: true });
  input.addEventListener('cancel', () => input.remove(), { once: true });
  input.click();
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = safeName(name); document.body.append(link); link.click(); link.remove();
  // Safari can still be reading the object URL after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function withAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** All files remain in this browser. Only model assets are fetched remotely. */
export class BrowserQueue {
  constructor({ decoder = decodeMedia, workerFactory, base = document.baseURI, onState = () => {}, onError = () => {} } = {}) {
    this.decoder = decoder;
    this.workerFactory = workerFactory || (() => new Worker(new URL('./transcribe-worker.js', import.meta.url), { type: 'module' }));
    this.base = base; this.onState = onState; this.onError = onError;
    this.jobs = []; this.files = new Map(); this.current = null; this.sequence = 0;
    this.models = Object.fromEntries(MODEL_NAMES.map(name => [name, { status: 'missing', size: null, downloaded: 0, total: null, speed: null, eta: null, error: null }]));
    this.downloads = new Map();
  }
  snapshot() { return { jobs: structuredClone(this.jobs), current_id: this.current?.job.id || null, models: structuredClone(this.models) }; }
  /** A model counts as downloaded only while the browser still holds it: it may evict the cache. */
  async checkModels() {
    const cached = await cachedModels();
    for (const name of MODEL_NAMES) if (this.models[name].status === 'missing' && cached.has(name) && readFlag(name)) this.models[name].status = 'ready';
    this.publish();
  }
  download(name) {
    const model = this.models[name];
    if (!model) throw new Error('Selecciona un modelo válido.');
    if (model.status !== 'missing') return;
    Object.assign(model, { status: 'downloading', downloaded: 0, total: null, speed: null, eta: null, error: null });
    const worker = this.workerFactory(), id = ++this.sequence, files = new Map(), window_ = [];
    this.downloads.set(name, worker);
    const end = changes => { worker.terminate(); this.downloads.delete(name); Object.assign(model, { speed: null, eta: null }, changes); this.publish(); };
    worker.addEventListener('message', ({ data }) => {
      if (data.id === id && data.type === 'result') { writeFlag(name); end({ status: 'ready' }); return; }
      if (data.id === id && data.type === 'failure') { end({ status: 'missing', error: 'No se pudo descargar. Revisa la conexión y reintenta.' }); return; }
      if (data.type !== 'download' || !data.total) return;
      files.set(data.file, { loaded: data.loaded, total: data.total });
      const all = [...files.values()], now = performance.now();
      model.downloaded = all.reduce((sum, file) => sum + file.loaded, 0);
      model.total = all.reduce((sum, file) => sum + file.total, 0);
      window_.push([now, model.downloaded]);
      while (window_.length > 2 && now - window_[0][0] > 5000) window_.shift();
      const seconds = (now - window_[0][0]) / 1000;
      if (seconds >= 1) { model.speed = (model.downloaded - window_[0][1]) / seconds; model.eta = model.speed ? (model.total - model.downloaded) / model.speed : null; }
      this.publish();
    });
    worker.addEventListener('error', () => end({ status: 'missing', error: 'No se pudo iniciar la descarga.' }));
    worker.postMessage({ type: 'load', id, model: name, language: null, wasmPath: new URL('./vendor/onnx/', this.base).href });
    this.publish();
  }
  cancelDownload(name) {
    const worker = this.downloads.get(name);
    if (!worker) return;
    worker.terminate(); this.downloads.delete(name);
    Object.assign(this.models[name], { status: 'missing', speed: null, eta: null }); this.publish();
  }
  startWaiting(model, language) {
    if (this.models[model]?.status !== 'ready') throw new Error('Descarga ese modelo antes de transcribir.');
    for (const job of this.jobs) if (job.status === 'waiting') Object.assign(job, { model, language: language && language !== 'auto' ? language : null, status: 'pending', stage: 'Pendiente' });
    this.publish(); this.advance();
  }
  publish() { this.onState(JSON.stringify(this.snapshot())); }
  add(files, model, language) {
    if (model && !MODEL_NAMES.includes(model)) throw new Error('Selecciona un modelo válido.');
    const added = [];
    for (const file of files) {
      const job = { id: crypto.randomUUID(), name: file.name, path: file.name, model: model || null,
        language: language && language !== 'auto' ? language : null, detected_language: null,
        status: model ? 'pending' : 'waiting', stage: model ? 'Pendiente' : 'Esperando modelo', progress: 0, speed: null, eta: null, duration: null, segments: [], preview: '', error: null };
      this.jobs.push(job); this.files.set(job.id, file); added.push(job.id);
    }
    this.publish(); this.advance(); return added;
  }
  advance() {
    if (this.current) return;
    const job = this.jobs.find(item => item.status === 'pending');
    if (job) this.run(job);
  }
  async checkpoint(runtime) {
    if (runtime.abort.signal.aborted) throw abortError();
    if (runtime.pauseRequested) {
      const stage = runtime.job.stage;
      runtime.job.status = 'paused'; runtime.job.stage = 'Pausado'; this.publish();
      await withAbort(new Promise(resolve => { runtime.unpause = resolve; }), runtime.abort.signal);
      runtime.unpause = null;
      runtime.job.status = 'processing'; runtime.job.stage = stage === 'Pausando' ? 'Transcribiendo' : stage;
      this.publish();
    }
  }
  request(runtime, type, payload = {}, transfer = []) {
    return withAbort(new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const message = ({ data }) => {
        if (data.id !== id) return;
        if (data.type === 'result' || data.type === 'failure') {
          cleanup(); data.type === 'failure' ? reject(new Error(data.error)) : resolve(data.result);
        }
      };
      const failed = event => { cleanup(); reject(new Error(event.message || 'No se pudo iniciar el motor Whisper.')); };
      const cleanup = () => {
        runtime.worker.removeEventListener('message', message); runtime.worker.removeEventListener('error', failed);
        runtime.abort.signal.removeEventListener('abort', cleanup);
      };
      runtime.worker.addEventListener('message', message); runtime.worker.addEventListener('error', failed);
      runtime.abort.signal.addEventListener('abort', cleanup, { once: true });
      runtime.worker.postMessage({ type, id, ...payload }, transfer);
    }), runtime.abort.signal);
  }
  async run(job) {
    const runtime = { job, abort: new AbortController(), worker: null, pauseRequested: false, unpause: null };
    this.current = runtime;
    Object.assign(job, { status: 'processing', stage: 'Leyendo audio', progress: null }); this.publish();
    try {
      const audio = await withAbort(this.decoder(this.files.get(job.id), {
        signal: runtime.abort.signal,
        onStage: stage => { if (!runtime.abort.signal.aborted) { job.stage = runtime.pauseRequested ? 'Pausando' : stage; this.publish(); } },
      }), runtime.abort.signal);
      if (!audio.length) throw new Error('El archivo no contiene audio decodificable.');
      job.duration = audio.length / 16000;
      await this.checkpoint(runtime);
      runtime.worker = this.workerFactory();
      runtime.worker.addEventListener('message', ({ data }) => {
        if (data.type === 'preview' && !runtime.abort.signal.aborted) {
          job.preview = data.text; this.publish(); return;
        }
        if (data.type !== 'download' || runtime.abort.signal.aborted) return;
        const percentage = data.progress == null ? '' : ` · ${Math.floor(data.progress)} %`;
        job.stage = runtime.pauseRequested ? 'Pausando' : data.status === 'progress' ? `Descargando modelo${percentage}` : 'Cargando modelo';
        job.download_progress = data.progress; this.publish();
      });
      job.stage = 'Cargando modelo'; this.publish();
      await this.request(runtime, 'load', { model: job.model, language: job.language, wasmPath: new URL('./vendor/onnx/', this.base).href });
      await this.checkpoint(runtime);
      job.progress = 0; job.stage = 'Transcribiendo'; this.publish();
      let offset = 0, activeSeconds = 0;
      while (offset < audio.length) {
        await this.checkpoint(runtime);
        const end = nextChunkEnd(audio, offset);
        const chunk = audio.slice(offset, end);
        const began = performance.now();
        const result = await this.request(runtime, 'transcribe', { audio: chunk, offset: offset / 16000 }, [chunk.buffer]);
        activeSeconds += (performance.now() - began) / 1000;
        job.segments.push(...result.segments);
        job.preview = '';
        job.detected_language = result.language || job.language;
        offset = end;
        const processed = offset / 16000;
        job.progress = Math.min(99.9, 100 * processed / job.duration);
        job.speed = activeSeconds ? processed / activeSeconds : null;
        job.eta = job.speed ? Math.max(0, (job.duration - processed) / job.speed) : null;
        job.stage = runtime.pauseRequested ? 'Pausando' : 'Transcribiendo'; this.publish();
      }
      Object.assign(job, { status: 'completed', stage: 'Completado', progress: 100, eta: 0 });
    } catch (error) {
      if (runtime.abort.signal.aborted || error.name === 'AbortError') {
        Object.assign(job, { status: 'cancelled', stage: 'Cancelado', speed: null, eta: null });
      } else {
        const message = /memory|allocation|out of bounds/i.test(error.message) ? 'Memoria insuficiente. Prueba el modelo Rápido o un archivo más corto.' : error.message;
        Object.assign(job, { status: 'error', stage: 'Error', error: message, speed: null, eta: null });
        this.onError(`${job.name}: ${message}`);
      }
    } finally {
      job.preview = '';
      runtime.worker?.terminate(); this.files.delete(job.id);
      if (this.current === runtime) this.current = null;
      this.publish(); this.advance();
    }
  }
  pause(id) {
    const runtime = this.current;
    if (runtime?.job.id !== id || runtime.job.status !== 'processing') return;
    runtime.pauseRequested = true; runtime.job.stage = 'Pausando'; this.publish();
  }
  resume(id) {
    const runtime = this.current;
    if (runtime?.job.id !== id) return;
    runtime.pauseRequested = false;
    if (runtime.unpause) runtime.unpause();
    else { runtime.job.stage = runtime.job.progress == null ? 'Preparando motor' : 'Transcribiendo'; this.publish(); }
  }
  cancel(id) {
    const job = this.jobs.find(item => item.id === id);
    if (!job || terminal.has(job.status)) return;
    if (this.current?.job.id === id) { this.current.abort.abort(); this.current.worker?.terminate(); }
    Object.assign(job, { status: 'cancelled', stage: 'Cancelado', speed: null, eta: null });
    this.files.delete(id); this.publish();
  }
  close() {
    for (const job of this.jobs) if (job.status === 'pending') job.status = 'cancelled';
    if (this.current) this.cancel(this.current.job.id);
    for (const name of [...this.downloads.keys()]) this.cancelDownload(name);
  }
}

export async function createBrowserBridge() {
  const response = await fetch(new URL('./config.json', document.baseURI));
  if (!response.ok) throw new Error('No se pudo cargar la configuración.');
  const settings = { ...await response.json(), platform: 'browser' };
  const bridge = { stateChanged: signal(), documentsLoaded: signal(), notified: signal() };
  const queue = new BrowserQueue({ onState: state => bridge.stateChanged.emit(state), onError: error => bridge.notified.emit(error) });
  const report = error => bridge.notified.emit(error?.message || String(error));
  Object.assign(bridge, {
    config(callback) { const json = JSON.stringify(settings); callback?.(json); return json; },
    ready() { queue.publish(); queue.checkModels(); },
    downloadModel(name) { try { queue.download(name); } catch (error) { report(error); } },
    cancelDownload(name) { queue.cancelDownload(name); },
    startJobs(model, language) { try { queue.startWaiting(model, language); } catch (error) { report(error); } },
    openMedia(model, language) { selectFiles('', files => { try { queue.add(files, model, language); } catch (error) { report(error); } }); },
    pause(id) { queue.pause(id); }, resume(id) { queue.resume(id); }, cancel(id) { queue.cancel(id); },
    exportJob(id, formatsJSON) {
      try {
        const job = queue.jobs.find(item => item.id === id);
        if (!job || (!job.segments.length && job.status !== 'completed')) throw new Error('La transcripción todavía no contiene texto.');
        const formats = [...new Set(JSON.parse(formatsJSON))];
        if (!formats.length || formats.some(format => !['txt', 'srt'].includes(format))) throw new Error('Selecciona TXT, SRT o ambos.');
        const stem = safeName(job.name.replace(/\.[^.]+$/, ''));
        const files = formats.map(format => ({ name: `${stem}.${format}`, content: format === 'txt' ? transcriptText(job.segments) : transcriptSrt(job.segments) }));
        if (files.length === 1) download(files[0].name, new Blob([files[0].content], { type: 'text/plain;charset=utf-8' }));
        else download(`${stem}.zip`, new Blob([zipFiles(files)], { type: 'application/zip' }));
        bridge.notified.emit('Exportado');
      } catch (error) { report(error); }
    },
    openAnalysis() {
      selectFiles('.txt,.srt', async files => {
        const documents = [];
        for (const file of files) {
          try {
            if (!/\.(txt|srt)$/i.test(file.name)) throw new Error('Selecciona un archivo TXT o SRT.');
            if (file.size > 80 * 1024 * 1024) throw new Error('El archivo supera 80 MB.');
            documents.push({ id: crypto.randomUUID(), name: file.name, text: decodeText(new Uint8Array(await file.arrayBuffer())) });
          } catch (error) { report(new Error(`${file.name}: ${error.message}`)); }
        }
        if (documents.length) bridge.documentsLoaded.emit(JSON.stringify(documents));
      });
    },
    saveText(name, content) { download(name, new Blob([content], { type: /\.html$/i.test(name) ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8' })); },
    async saveImage(name, dataURL) {
      try {
        if (!dataURL.startsWith('data:image/png;base64,')) throw new Error('Imagen no válida.');
        download(name, await (await fetch(dataURL)).blob());
      } catch (error) { report(error); }
    },
    async saveChart(name, figureJSON) {
      try {
        const figure = JSON.parse(figureJSON);
        const figures = figure.figures || [figure];
        if (!figures.length || figures.some(item => !Array.isArray(item.data))) throw new Error('Gráfica no válida.');
        const response = await fetch(new URL('./vendor/plotly.min.js', document.baseURI));
        if (!response.ok) throw new Error('No se pudo exportar la gráfica.');
        const plotly = (await response.text()).replace(/<\/script/gi, '<\\/script');
        const payload = JSON.stringify(figures).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
        const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Análisis</title><style>body{margin:0}.plot{min-height:480px}</style><main id="plots"></main><script>${plotly}</script><script>const figures=${payload};figures.forEach((figure,i)=>{const target=document.createElement('div');target.className='plot';document.getElementById('plots').appendChild(target);Plotly.newPlot(target,figure.data,figure.layout,{...figure.config,responsive:true,scrollZoom:true,displaylogo:false});});</script></html>`;
        download(name, new Blob([html], { type: 'text/html;charset=utf-8' }));
      } catch (error) { report(error); }
    },
  });
  window.addEventListener('beforeunload', event => {
    if (queue.jobs.some(job => !terminal.has(job.status) && job.status !== 'waiting')) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('pagehide', () => queue.close());
  return bridge;
}

if (typeof window !== 'undefined') window.createBrowserBridge = createBrowserBridge;
