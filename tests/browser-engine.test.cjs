const test = require('node:test');
const assert = require('node:assert/strict');

test('Imported text handles UTF-16 and Windows-1252', async () => {
  const { decodeText } = await import('../web/browser-engine.js');
  assert.equal(decodeText(new Uint8Array([0xff,0xfe,0x41,0,0xe1,0])), 'Aá');
  assert.equal(decodeText(new Uint8Array([0xe1])), 'á');
});
