#!/usr/bin/env node

const assert = require('assert');
const {
  findSampleFiles,
  mergeSampleFiles,
  shouldIncludeSampleFiles,
} = require('../src/rag/sampleMatcher');

const cases = [
  {
    title: 'gridView mergeCells sample',
    source: 'dev-guide-sample',
    content: 'gridView mergeCells bycol mergeCol sample xml',
    attachmentDir: 'dev-guide-sample/GridView/Merge',
    attachments: [
      { filename: 'mergeCells_GridView.xml', mimeType: 'application/xml', size: 1000 },
    ],
  },
];

assert.strictEqual(shouldIncludeSampleFiles('gridView mergeCells 사용 방법 알려주세요'), false);
assert.strictEqual(shouldIncludeSampleFiles('gridView mergeCells 예제도 주세요'), true);
assert.deepStrictEqual(findSampleFiles('gridView mergeCells 사용 방법 알려주세요', cases), []);

const explicit = findSampleFiles('gridView mergeCells 예제 xml 주세요', cases);
assert.ok(explicit.length <= 2);

const merged = mergeSampleFiles(
  [
    { filename: 'a.xml', downloadUrl: '/api/attachment?dir=x&filename=a.xml' },
    { filename: 'b.xml', downloadUrl: '/api/attachment?dir=x&filename=b.xml' },
  ],
  [
    { filename: 'c.xml', downloadUrl: '/api/attachment?dir=x&filename=c.xml' },
  ]
);
assert.strictEqual(merged.length, 2);

console.log('sampleFiles policy tests passed');
