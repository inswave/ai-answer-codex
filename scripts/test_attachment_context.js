#!/usr/bin/env node

const assert = require('assert');
const { buildQuestionAttachmentContext } = require('../src/generator/attachmentContext');
const { evaluateAnswerPolicy } = require('../src/generator/answerPolicy');

const result = buildQuestionAttachmentContext([
  {
    filename: 'sample.xml',
    size: 120,
    text: '<xf:select1 id="selectbox1"><xf:itemset nodeset="data:list1"/></xf:select1>',
  },
  {
    filename: 'screen.png',
    size: 2048,
    content: 'binary image data should not be analyzed',
  },
  {
    filename: 'license.key',
    size: 20,
    text: 'secret',
  },
  {
    filename: 'archive.zip',
    size: 200,
  },
]);

assert.strictEqual(result.hasAttachments, true);
assert.strictEqual(result.summary.total, 4);
assert.strictEqual(result.summary.analyzedTextCount, 1);
assert.strictEqual(result.summary.imageOnlyCount, 1);
assert.strictEqual(result.summary.blockedCount, 2);
assert.match(result.context, /고객 첨부파일 정보/);
assert.match(result.context, /첨부파일 분석 내용/);
assert.match(result.context, /selectbox1/);
assert.doesNotMatch(result.context, /binary image data/);
assert.match(result.policyText, /PNG 이미지 첨부/);
assert.match(result.policyText, /위험 첨부/);

const imagePolicy = evaluateAnswerPolicy({
  question: `이미지 캡처 확인 부탁드립니다.\n${buildQuestionAttachmentContext([
    { filename: 'screen.png', size: 1000 },
  ]).policyText}`,
  cases: [],
});
assert.strictEqual(imagePolicy.answerMode, 'needs_context');

const riskyPolicy = evaluateAnswerPolicy({
  question: result.policyText,
  cases: [],
});
assert.strictEqual(riskyPolicy.answerMode, 'blocked');

console.log('attachmentContext tests passed');
