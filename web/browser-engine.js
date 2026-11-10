// The browser edition offers only the analysis tool; transcription is desktop-only.
export function safeName(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '') || 'transcripcion';
}

export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}

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

export async function createBrowserBridge() {
  const response = await fetch(new URL('./config.json', document.baseURI));
  if (!response.ok) throw new Error('No se pudo cargar la configuración.');
  const settings = { ...await response.json(), platform: 'browser' };
  const bridge = { stateChanged: signal(), documentsLoaded: signal(), notified: signal() };
  const report = error => bridge.notified.emit(error?.message || String(error));
  Object.assign(bridge, {
    config(callback) { const json = JSON.stringify(settings); callback?.(json); return json; },
    ready() {},
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
  return bridge;
}

if (typeof window !== 'undefined') window.createBrowserBridge = createBrowserBridge;
