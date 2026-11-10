const test = require('node:test');
const assert = require('node:assert/strict');

test('SubRip timestamps carry rounding; text preserves Spanish', async () => {
  const { timestamp, transcriptSrt, transcriptText } = await import('../web/transcription-utils.js');
  const segments = [{ start: 59.9996, end: 62.25, text: ' Análisis de audio. ' }];
  assert.equal(timestamp(59.9996), '00:01:00,000');
  assert.equal(transcriptSrt(segments), '1\n00:01:00,000 --> 00:01:02,250\nAnálisis de audio.\n');
  assert.equal(transcriptText(segments), 'Análisis de audio.\n');
});

test('Chunk windows cover the entire input without overlaps or gaps', async () => {
  const { nextChunkEnd } = await import('../web/transcription-utils.js');
  const audio = new Float32Array(16000 * 80).fill(0.1);
  audio.fill(0, 16000 * 24, 16000 * 24.2);
  let start = 0, total = 0, count = 0;
  while (start < audio.length) {
    const end = nextChunkEnd(audio, start);
    assert.ok(end > start);
    assert.ok(end - start <= 25 * 16000);
    total += end - start; start = end; count++;
  }
  assert.equal(total, audio.length);
  assert.equal(count, 4);
});

test('Subtitles use absolute timestamps and handle missing final timestamp', async () => {
  const { subtitleSegments } = await import('../web/transcription-utils.js');
  assert.deepEqual(subtitleSegments({chunks:[{text:' Hola ',timestamp:[2,null]}]}, 25, 10), [{start:27,end:35,text:'Hola'}]);
});

test('Browser ZIP has matching UTF-8 names and correct CRC32', async () => {
  const { zipFiles } = await import('../web/transcription-utils.js');
  const bytes = zipFiles([{ name: 'análisis.txt', content: '123456789' }, { name:'análisis.srt', content:'1\n' }]);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(14, true), 0xcbf43926);
  assert.equal(view.getUint16(6, true), 0x800);
  const eocd = bytes.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);
  assert.equal(view.getUint16(eocd + 10, true), 2);
  const centralOffset = view.getUint32(eocd + 16, true);
  assert.equal(view.getUint32(centralOffset, true), 0x02014b50);
  assert.equal(new TextDecoder().decode(bytes.slice(30, 30 + view.getUint16(26, true))), 'análisis.txt');
});

test('Imported text handles UTF-16 and Windows-1252', async () => {
  const { decodeText } = await import('../web/transcription-utils.js');
  assert.equal(decodeText(new Uint8Array([0xff,0xfe,0x41,0,0xe1,0])), 'Aá');
  assert.equal(decodeText(new Uint8Array([0xe1])), 'á');
});

class FakeWorker {
  constructor(all) { this.events = new Map(); this.pending = []; this.dead = false; all.push(this); }
  addEventListener(name, fn) { if (!this.events.has(name)) this.events.set(name,new Set()); this.events.get(name).add(fn); }
  removeEventListener(name, fn) { this.events.get(name)?.delete(fn); }
  postMessage(data) { this.pending.push(data); }
  emit(data) { for (const fn of [...(this.events.get('message') || [])]) fn({data}); }
  reply(result) { const message=this.pending.shift(); assert.ok(message); this.emit({type:'result',id:message.id,result}); return message; }
  terminate() { this.dead = true; this.events.clear(); }
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('Browser queue pauses only after current chunk, resumes once, and stays serial', async () => {
  const { BrowserQueue } = await import('../web/browser-engine.js');
  const workers = [];
  const queue = new BrowserQueue({ base:'https://example.test/', decoder: async()=>new Float32Array(16000*30).fill(0.1), workerFactory:()=>new FakeWorker(workers) });
  const ids = queue.add([{name:'uno.wav'},{name:'dos.wav'}], 'tiny', 'es');
  await settle();
  assert.equal(workers.length,1);
  workers[0].reply({ready:true}); await settle();
  assert.equal(workers[0].pending[0].type,'transcribe');
  queue.pause(ids[0]);
  assert.equal(queue.snapshot().jobs[0].stage,'Pausando');
  workers[0].reply({segments:[{start:0,end:25,text:'Prueba'}],language:'es'}); await settle();
  assert.equal(queue.snapshot().jobs[0].status,'paused');
  assert.equal(workers[0].pending.length,0);
  assert.equal(workers.length,1);
  queue.resume(ids[0]); await settle();
  assert.equal(workers[0].pending.length,1);
  workers[0].reply({segments:[{start:25,end:30,text:'Final'}],language:'es'}); await settle();
  assert.equal(queue.snapshot().jobs[0].status,'completed');
  assert.equal(workers[0].dead,true);
  assert.equal(workers.length,2);
  assert.equal(queue.snapshot().jobs[1].status,'processing');
  queue.close(); await settle();
});

test('Cancelling active browser worker keeps partial text and starts next file', async () => {
  const { BrowserQueue } = await import('../web/browser-engine.js');
  const workers=[];
  const queue=new BrowserQueue({base:'https://example.test/', decoder:async()=>new Float32Array(16000*60).fill(0.1), workerFactory:()=>new FakeWorker(workers)});
  const ids=queue.add([{name:'uno.wav'},{name:'dos.wav'}],'tiny',null);
  await settle(); workers[0].reply({ready:true}); await settle();
  workers[0].reply({segments:[{start:0,end:25,text:'Conservar'}],language:'es'}); await settle();
  queue.cancel(ids[0]); await settle();
  assert.equal(workers[0].dead,true);
  assert.equal(queue.snapshot().jobs[0].status,'cancelled');
  assert.equal(queue.snapshot().jobs[0].segments[0].text,'Conservar');
  assert.equal(workers.length,2);
  queue.close(); await settle();
});
