#!/usr/bin/env node

const assert = require('assert');
const { getImageBuffer, isImageAttachment, enrichAttachmentsWithOcr } = require('../src/generator/ocr');

const pngData = Buffer.from('fake image bytes').toString('base64');

assert.strictEqual(isImageAttachment({ filename: 'screen.png' }), true);
assert.strictEqual(isImageAttachment({ filename: 'capture.bin', mimeType: 'image/png' }), true);
assert.strictEqual(isImageAttachment({ filename: 'sample.xml' }), false);

assert.deepStrictEqual(getImageBuffer({
  filename: 'screen.png',
  encoding: 'base64',
  data: pngData,
}), Buffer.from('fake image bytes'));

assert.deepStrictEqual(getImageBuffer({
  filename: 'screen.png',
  encoding: 'base64',
  data: `data:image/png;base64,${pngData}`,
}), Buffer.from('fake image bytes'));

(async () => {
  const disabled = await enrichAttachmentsWithOcr([
    { filename: 'screen.png', encoding: 'base64', data: pngData },
  ], { ocr: { enabled: false } });

  assert.strictEqual(disabled[0].ocrStatus, undefined);
  console.log('ocr tests passed');
})();
