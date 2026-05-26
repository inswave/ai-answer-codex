#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ApiVerifier = require('../src/generator/apiVerifier');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techassistant-api-docs-'));
const htmlPath = path.join(tmpDir, 'WebSquare.uiplugin.gridView.html');

fs.writeFileSync(
  htmlPath,
  '<html><body><dt class="apiname">displayFormatter</dt><dt>getCellData</dt></body></html>',
  'utf8'
);

const verifier = new ApiVerifier();
verifier.localDocConfig = {
  sourceDirs: [tmpDir],
  extensions: ['.html'],
};
verifier.localDocIndex = null;

const localResults = verifier.verifyBatchInLocalDocs(['displayFormatter', 'displayFormatterExtra', 'getCellData']);
assert.strictEqual(localResults.find((r) => r.name === 'displayFormatter').found, true);
assert.strictEqual(localResults.find((r) => r.name === 'displayFormatterExtra').found, false);
assert.strictEqual(localResults.find((r) => r.name === 'getCellData').found, true);

const merged = verifier.mergeVerificationResults(
  ['displayFormatter', 'unknownApi'],
  [
    { name: 'displayFormatter', found: false },
    { name: 'unknownApi', found: true, source: 'RAG sample' },
  ],
  new Map(localResults.map((item) => [item.name, item])),
  true
);

assert.strictEqual(merged.find((r) => r.name === 'displayFormatter').found, true);
assert.strictEqual(merged.find((r) => r.name === 'displayFormatter').sourceType, 'local-docs');
assert.strictEqual(merged.find((r) => r.name === 'unknownApi').found, false);
assert.strictEqual(merged.find((r) => r.name === 'unknownApi').sourceType, 'rag-only');

const extracted = verifier.extractApiNames(`
scwin.changeInnerComponent = function (value) {
  ibx_inner.setValue(value);
};
scwin.isReady = false;
scwin.pendingCondition = null;

var cmpResult = $p.dynamicCreate("xf:input", { id: "ibx_inner" });
TypeError: Cannot read properties of undefined (reading setValue)
udc1.changeInnerComponent("초기값");
cmpResult.setValue("변경값");
\`cmpResult\`
\`$p.dynamicCreate()\`
\`cmpResult.setValue()\`
\`udc1.changeInnerComponent()\`
\`fn_afterAllUdcReady()\`
\`ibx_inner\`
\`gridView.setRowBackgroundColor()\`
`);

assert.strictEqual(extracted.includes('changeInnerComponent'), false);
assert.strictEqual(extracted.includes('cmpResult'), false);
assert.strictEqual(extracted.includes('cmpResult.setValue'), false);
assert.strictEqual(extracted.includes('fn_afterAllUdcReady'), false);
assert.strictEqual(extracted.includes('ibx_inner'), false);
assert.strictEqual(extracted.includes('isReady'), false);
assert.strictEqual(extracted.includes('pendingCondition'), false);
assert.strictEqual(extracted.includes('gridView.setRowBackgroundColor'), false);
assert.strictEqual(extracted.includes('undefined'), false);
assert.strictEqual(extracted.includes('dynamicCreate'), true);
assert.strictEqual(extracted.includes('setValue'), true);
assert.strictEqual(extracted.includes('setRowBackgroundColor'), true);

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('apiVerifier local docs tests passed');
