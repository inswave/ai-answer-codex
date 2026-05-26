#!/usr/bin/env node

const assert = require('assert');
const { toSources } = require('../src/rag/parseRagResults');

const cases = [
  {
    title: 'gridView mergeCells sample',
    source: 'WebSquare SP5 Dev Guide',
    match: 92,
    attachmentDir: 'dev-guide-sample/GridView/Merge',
    attachments: [
      { filename: 'mergeCells_GridView.xml', mimeType: 'application/xml', size: 1000 },
    ],
  },
];

const hidden = toSources(cases, { includeAttachments: false });
assert.strictEqual(hidden.length, 1);
assert.strictEqual(hidden[0].attachments, undefined);

const visible = toSources(cases, { includeAttachments: true });
assert.strictEqual(visible.length, 1);
assert.strictEqual(visible[0].attachments.length, 1);
assert.strictEqual(visible[0].attachments[0].filename, 'mergeCells_GridView.xml');

console.log('sources attachment policy tests passed');
