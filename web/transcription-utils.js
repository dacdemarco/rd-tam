export function timestamp(seconds) {
  let ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3600000); ms %= 3600000;
  const minutes = Math.floor(ms / 60000); ms %= 60000;
  const secs = Math.floor(ms / 1000); ms %= 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function transcriptText(segments) {
  const text = segments.map(s => s.text.trim()).filter(Boolean).join('\n');
  return text ? text + '\n' : '';
}

export function transcriptSrt(segments) {
  return segments.filter(s => s.text.trim()).map((s, i) =>
    `${i + 1}\n${timestamp(s.start)} --> ${timestamp(Math.max(s.start + 0.001, s.end))}\n${s.text.split(/\r?\n/).map(x => x.trim()).filter(Boolean).join('\n')}\n`
  ).join('\n');
}

export function safeName(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '') || 'transcripcion';
}

export function subtitleSegments(result, offset, duration) {
  const raw = result.chunks?.length ? result.chunks : (result.text?.trim() ? [{ text: result.text, timestamp: [0, duration] }] : []);
  return raw.filter(chunk => chunk.text?.trim()).map(chunk => {
    const start = Math.max(0, Math.min(duration, Number(chunk.timestamp?.[0]) || 0));
    const endValue = chunk.timestamp?.[1] == null ? duration : Number(chunk.timestamp[1]);
    const end = Math.max(start, Math.min(duration, Number.isFinite(endValue) ? endValue : duration));
    return { start: offset + start, end: offset + end, text: chunk.text.trim() };
  });
}

// Prefer a quiet boundary in the final two seconds; no sample is skipped/repeated.
export function nextChunkEnd(audio, start, sampleRate = 16000) {
  const end = Math.min(audio.length, start + 25 * sampleRate);
  if (end === audio.length) return end;
  let best = end, quietest = 0.0004;
  const window = Math.round(sampleRate * 0.02);
  for (let at = end - 2 * sampleRate; at + window <= end; at += window) {
    let energy = 0;
    for (let i = at; i < at + window; i++) energy += audio[i] * audio[i];
    energy /= window;
    if (energy < quietest) { quietest = energy; best = at + Math.floor(window / 2); }
  }
  return best;
}

// A small standards-compliant, uncompressed UTF-8 ZIP keeps a paired TXT/SRT
// export to one browser download, avoiding automatic multi-download blocking.
export function zipFiles(files) {
  const encoder = new TextEncoder();
  const local = [], central = [];
  let offset = 0;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  const write = (size, values) => {
    const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
    for (const [at, width, value] of values) width === 4 ? view.setUint32(at, value, true) : view.setUint16(at, value, true);
    return bytes;
  };
  for (const file of files) {
    const name = encoder.encode(safeName(file.name));
    const data = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    let crc = 0xffffffff;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = write(30, [[0,4,0x04034b50],[4,2,20],[6,2,0x800],[14,4,crc],[18,4,data.length],[22,4,data.length],[26,2,name.length]]);
    local.push(header, name, data);
    const directory = write(46, [[0,4,0x02014b50],[4,2,20],[6,2,20],[8,2,0x800],[16,4,crc],[20,4,data.length],[24,4,data.length],[28,2,name.length],[42,4,offset]]);
    central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = write(22, [[0,4,0x06054b50],[8,2,files.length],[10,2,files.length],[12,4,centralSize],[16,4,offset]]);
  const result = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...local, ...central, end]) { result.set(part, cursor); cursor += part.length; }
  return result;
}

export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}
