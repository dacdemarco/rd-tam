import { FFmpeg } from '@ffmpeg/ffmpeg';

const SAMPLE_RATE = 16000;
// WASM decoding holds the source, output and codec buffers in memory at once.
export const MAX_BROWSER_FILE_BYTES = 512 * 1024 * 1024;
const MAX_PCM_BYTES = 512 * 1024 * 1024;

function aborted() {
  return new DOMException('Transcripción cancelada.', 'AbortError');
}

function checkAbort(signal) {
  if (signal?.aborted) throw aborted();
}

function abortable(promise, signal, stop = () => {}) {
  if (!signal) return promise;
  if (signal.aborted) { stop(); return Promise.reject(aborted()); }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      try { stop(); } finally { reject(aborted()); }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

function memoryError(error) {
  return error instanceof RangeError || /out of memory|allocation|array buffer|memory access|memory limit|cannot enlarge/i.test(String(error?.message || error));
}

function insufficientMemory() {
  return new Error('El archivo supera la memoria disponible del navegador. Divide el audio o usa la versión de escritorio.');
}

async function decodeNative(file, signal) {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  const OfflineContextClass = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!AudioContextClass || !OfflineContextClass) throw new Error('Decodificador nativo no disponible.');
  let context;
  let source;
  try {
    // Request 16 kHz during decoding too, to avoid retaining a high-rate buffer
    // unnecessarily. The separate offline render guarantees the output rate.
    context = new AudioContextClass({ sampleRate: SAMPLE_RATE });
    const close = () => { if (context.state !== 'closed') context.close().catch(() => {}); };
    const bytes = await abortable(file.arrayBuffer(), signal, close);
    checkAbort(signal);
    const decoded = await abortable(context.decodeAudioData(bytes), signal, close);
    checkAbort(signal);
    if (!decoded.length || !decoded.numberOfChannels) throw new Error('El archivo no contiene audio.');
    const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
    if (!Number.isFinite(frames) || frames * 4 > MAX_PCM_BYTES) throw insufficientMemory();
    const offline = new OfflineContextClass(1, Math.max(1, frames), SAMPLE_RATE);
    source = offline.createBufferSource();
    source.buffer = decoded;
    // The Web Audio speaker mixing matrix averages stereo to mono and handles
    // other layouts without simply throwing away all but the left channel.
    source.channelCount = 1;
    source.channelCountMode = 'explicit';
    source.channelInterpretation = 'speakers';
    source.connect(offline.destination);
    source.start();
    const rendered = await abortable(offline.startRendering(), signal, () => {
      try { source.stop(); source.disconnect(); } catch { /* Already finished. */ }
    });
    checkAbort(signal);
    return rendered.getChannelData(0).slice();
  } finally {
    if (source) { try { source.disconnect(); } catch { /* Already disconnected. */ } }
    if (context && context.state !== 'closed') await context.close().catch(() => {});
  }
}

async function decodeWithFFmpeg(file, signal, onStage) {
  const ffmpeg = new FFmpeg();
  let lastLog = '';
  const onLog = ({ message }) => { lastLog = String(message || '').slice(-800); };
  const terminate = () => { try { ffmpeg.terminate(); } catch { /* Not yet loaded. */ } };
  signal?.addEventListener('abort', terminate, { once: true });
  try {
    checkAbort(signal);
    onStage('Preparando decodificador');
    const base = new URL('vendor/ffmpeg/', document.baseURI);
    ffmpeg.on('log', onLog);
    // The single-threaded core works without SharedArrayBuffer or COOP/COEP.
    // Both assets are part of the distribution; no media reaches a server.
    await abortable(ffmpeg.load({
      coreURL: new URL('ffmpeg-core.js', base).href,
      wasmURL: new URL('ffmpeg-core.wasm', base).href,
    }), signal, terminate);
    checkAbort(signal);
    const suffix = /\.([a-z0-9]{1,12})$/i.exec(file.name || '')?.[1] || 'media';
    const inputName = `input.${suffix}`;
    onStage('Decodificando audio');
    const bytes = new Uint8Array(await abortable(file.arrayBuffer(), signal, terminate));
    checkAbort(signal);
    await abortable(ffmpeg.writeFile(inputName, bytes), signal, terminate);
    const status = await abortable(ffmpeg.exec([
      '-hide_banner', '-v', 'error', '-i', inputName,
      '-map', '0:a:0', '-vn', '-sn', '-dn', '-ac', '1', '-ar', String(SAMPLE_RATE),
      '-f', 'f32le', '-acodec', 'pcm_f32le', 'audio.f32',
    ]), signal, terminate);
    if (status !== 0) {
      if (memoryError(lastLog)) throw insufficientMemory();
      throw new Error('No se pudo decodificar el archivo. Comprueba que contiene audio y que su formato no está dañado o protegido.');
    }
    const output = await abortable(ffmpeg.readFile('audio.f32'), signal, terminate);
    checkAbort(signal);
    if (!(output instanceof Uint8Array) || !output.byteLength || output.byteLength % 4) {
      throw new Error('El archivo no contiene una pista de audio válida.');
    }
    if (output.byteLength > MAX_PCM_BYTES) throw insufficientMemory();
    const aligned = output.byteOffset % 4 === 0 ? output : output.slice();
    return new Float32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 4);
  } catch (error) {
    checkAbort(signal);
    if (memoryError(error)) throw insufficientMemory();
    throw error;
  } finally {
    signal?.removeEventListener('abort', terminate);
    ffmpeg.off('log', onLog);
    // Release WASM memory and every in-memory source/output file per job.
    terminate();
  }
}

/** Decode a local File/Blob to mono PCM at 16 kHz, with no server upload.
 * The caller may transfer the returned buffer to its transcription worker.
 * onStage receives short Spanish status text, never a guessed percentage.
 */
export async function decodeMedia(file, { signal, onStage = () => {} } = {}) {
  checkAbort(signal);
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Selecciona un archivo de audio o video.');
  if (!file.size) throw new Error('El archivo está vacío.');
  if (file.size > MAX_BROWSER_FILE_BYTES) {
    throw new Error('El navegador admite archivos de hasta 512 MB. Divide el archivo o usa la versión de escritorio.');
  }
  onStage('Decodificando audio');
  try {
    return await decodeNative(file, signal);
  } catch (error) {
    checkAbort(signal);
    if (memoryError(error) || /supera la memoria/.test(error?.message || '')) throw insufficientMemory();
    // Unsupported containers/codecs use the bundled FFmpeg decoder.
  }
  return decodeWithFFmpeg(file, signal, onStage);
}
