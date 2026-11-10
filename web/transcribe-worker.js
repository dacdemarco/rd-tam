import { env, pipeline } from '@huggingface/transformers';
import { subtitleSegments } from './transcription-utils.js';

let transcriber;
let detectedLanguage;
const emit = (type, payload = {}) => self.postMessage({ type, ...payload });

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.proxy = false;
      env.backends.onnx.wasm.wasmPaths = data.wasmPath;
      detectedLanguage = data.language || null;
      transcriber = await pipeline('automatic-speech-recognition', `Xenova/whisper-${data.model}`, {
        device: 'wasm', dtype: 'q8',
        progress_callback: progress => emit('download', {
          file: progress.file || '', status: progress.status,
          loaded: progress.loaded || 0, total: progress.total || 0,
          progress: typeof progress.progress === 'number' ? progress.progress : null,
        }),
      });
      emit('result', { id, result: { ready: true } });
    } else if (type === 'transcribe') {
      const audio = data.audio;
      let nonSilent = false;
      for (let i = 0; i < audio.length; i++) if (Math.abs(audio[i]) > 0.00001) { nonSilent = true; break; }
      if (!nonSilent) {
        emit('result', { id, result: { segments: [], language: detectedLanguage } });
        return;
      }
      // Capture Whisper's generated language token on the first chunk. Fixing
      // this language for later chunks avoids detection oscillating on pauses.
      const previewTokens = [];
      let lastPreview = 0;
      const streamer = {
        put(tokens) {
          const flat = tokens.flat ? tokens.flat() : tokens;
          previewTokens.push(...flat);
          if (!detectedLanguage) {
            const decoded = transcriber.tokenizer.decode(flat, { skip_special_tokens: false });
            const match = decoded.match(/<\|([a-z]{2,3})\|>/);
            if (match) detectedLanguage = match[1];
          }
          if (performance.now() - lastPreview > 150) {
            lastPreview = performance.now();
            emit('preview', { text: transcriber.tokenizer.decode(previewTokens, { skip_special_tokens: true }).trim() });
          }
        },
        end() {},
      };
      const options = {
        task: 'transcribe', return_timestamps: true,
        max_new_tokens: 440, num_beams: 1, do_sample: false, streamer,
      };
      if (detectedLanguage) options.language = detectedLanguage;
      const output = await transcriber(audio, options);
      emit('result', { id, result: {
        segments: subtitleSegments(output, data.offset, audio.length / 16000),
        language: detectedLanguage,
      } });
    }
  } catch (error) {
    emit('failure', { id, error: error?.message || String(error) });
  }
};
