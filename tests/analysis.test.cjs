const test = require('node:test');
const assert = require('node:assert/strict');
require('../web/analysis.js');
const api = globalThis.RDAnalysis;
const fs = require('node:fs');
const path = require('node:path');

test('SRT parses BOM, CRLF, multiline, no index and positioning metadata', () => {
  const srt = '\uFEFF1\r\n00:00:01,200 --> 00:00:03,450\r\nUn río\r\nazul.\r\n\r\n00:00:04.50 --> 00:00:06.000 X1:10\r\nOtro bosque.';
  const segments = api.parseSrt(srt);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].start, 1.2);
  assert.equal(segments[0].end, 3.45);
  assert.equal(segments[0].text, 'Un río\nazul.');
  assert.equal(segments[1].start, 4.5);
});

test('Invalid SRT never silently creates invented timings', () => {
  assert.throws(() => api.parseSrt('1\n00:61:01,200 --> 00:01:03,450\nHola'), /inválida/);
  assert.throws(() => api.parseSrt('1\n00:00:10,000 --> 00:00:01,000\nHola'), /antes/);
  assert.throws(() => api.parseSrt('Sin tiempos'), /SRT inválido/);
  assert.throws(() => api.parseDocument({name: 'empty.srt', text: ''}), /vacío/);
});

test('TXT has word positions, preserving paragraphs without fake timestamps', () => {
  const doc = api.parseDocument({id: 'txt', name: 'Notas.TXT', text: 'Uno dos tres\ncuatro.\n\nCinco seis.'});
  assert.equal(doc.temporal, false);
  assert.deepEqual(doc.segments.map(segment => [segment.start, segment.end]), [[0, 4], [4, 6]]);
  assert.equal(doc.segments.length, 2);
});

test('Literal word/phrase matching handles accents, case and line breaks', () => {
  const text = 'El RÍO\nazul, un rio azul y un ríozul.';
  const matches = api.matchesIn(text, 'río azul');
  assert.equal(matches.length, 2);
  assert.equal(text.slice(matches[0].start, matches[0].end), 'RÍO\nazul');
  assert.equal(api.matchesIn('bosque bosques subbosque bosque.', 'bosque').length, 2);
  assert.equal(api.matchesIn('a+b a b aa+b', 'a+b').length, 1);
  assert.equal(api.matchesIn('foo.* foo bar', '.*').length, 1);
});

test('Decomposed accents map highlights to original positions', () => {
  const source = 'un cafe\u0301 azul';
  const [match] = api.matchesIn(source, 'CAFÉ');
  assert.equal(source.slice(match.start, match.end), 'cafe\u0301');
});

test('Context contains exactly the requested surrounding words', () => {
  const text = 'uno dos tres bosque cuatro cinco seis';
  const [match] = api.matchesIn(text, 'bosque');
  assert.deepEqual(api.contextFor(text, match, 2), {before: 'dos tres ', keyword: 'bosque', after: ' cuatro cinco', prefix: true, suffix: true});
  assert.equal(api.contextFor(text, match, 0).before, '');
});

test('Index counts occurrences and segments separately, stopwords toggles', () => {
  const doc = api.parseDocument({id: 'a', name: 'a.srt', text: '1\n00:00:01,000 --> 00:00:03,000\nEl bosque y bosque.\n\n2\n00:00:04,000 --> 00:00:05,000\nEl río.'});
  const result = api.analyze([doc], 'bosque', 5, true);
  assert.equal(result.matches.length, 2);
  assert.equal(result.matchedSegments.size, 1);
  assert.equal(result.frequencies.find(item => item.word === 'bosque').count, 2);
  assert.equal(result.frequencies.find(item => item.word === 'el'), undefined);
  assert.equal(api.analyze([doc], '', 5, false).frequencies.find(item => item.word === 'el').count, 2);
});

test('Untrusted text and filenames escape HTML without losing plain text', () => {
  const attack = '</script><img src=x onerror="alert(1)">&';
  const parsed = api.parseDocument({name: 'unsafe.txt', text: attack});
  assert.equal(parsed.segments[0].text, attack);
  assert.equal(api.escapeHtml(attack), '&lt;/script&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;');
  assert.ok(!api.escapeHtml(attack).includes('<'));
});

test('Timestamps round correctly across second, minute, and hour boundaries', () => {
  assert.equal(api.formatTime(59.9998, true), '00:01:00,000');
  assert.equal(api.formatTime(3600, false), '01:00:00');
  assert.equal(api.timestamp('100:01:02,003'), 360062.003);
});

test('QA fixtures index together without mixing time and word coordinates', () => {
  const names = ['entrevista.srt', 'notas.txt'];
  const docs = names.map((name, index) => api.parseDocument({id: String(index), name, text: fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')}));
  const result = api.analyze(docs, 'río azul');
  assert.deepEqual(docs.map(doc => doc.temporal), [true, false]);
  assert.equal(result.matches.length, 6);
  assert.ok(result.matches.some(match => match.document.temporal && match.segment.start === 6.1));
  assert.ok(result.matches.some(match => !match.document.temporal));
});

test('A typical 2,470-cue interview indexes and searches within five seconds', () => {
  const source = Array.from({length: 2470}, (_, index) => `${index + 1}\n${api.formatTime(index * 3, true)} --> ${api.formatTime(index * 3 + 2.8, true)}\nEl bosque guarda nuestra memoria. Esta entrevista documenta una conversación con la comunidad.`).join('\n\n');
  const start = performance.now();
  const doc = api.parseDocument({id: 'long', name: 'long.srt', text: source});
  const result = api.analyze([doc], 'bosque', 5);
  assert.equal(doc.segments.length, 2470);
  assert.equal(result.matches.length, 2470);
  assert.equal(result.frequencies.find(item => item.word === 'bosque').count, 2470);
  assert.ok(performance.now() - start < 5000, 'Typical interview should remain interactive');
});

test('Long unbroken TXT paragraphs avoid quadratic context scanning', () => {
  const doc = api.parseDocument({id: 'txt-long', name: 'long.txt', text: 'Un bosque con memoria. '.repeat(10000)});
  const start = performance.now();
  const result = api.analyze([doc], 'bosque', 5);
  assert.equal(result.matches.length, 10000);
  assert.ok(performance.now() - start < 5000, 'Large paragraphs should remain searchable');
});
