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
    encoding: 'base64',
    data: Buffer.from('fake image bytes').toString('base64'),
  },
  {
    filename: 'error.jpg',
    size: 4096,
    encoding: 'base64',
    data: Buffer.from('fake jpg bytes').toString('base64'),
    ocrStatus: 'ok',
    ocrText: '파일이 암호화되어 있습니다',
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
assert.strictEqual(result.summary.total, 5);
assert.strictEqual(result.summary.analyzedTextCount, 1);
assert.strictEqual(result.summary.imageOnlyCount, 2);
assert.strictEqual(result.summary.imagePayloadCount, 2);
assert.strictEqual(result.summary.imageOcrCount, 1);
assert.strictEqual(result.summary.blockedCount, 2);
assert.match(result.context, /고객 첨부파일 정보/);
assert.match(result.context, /첨부파일 분석 내용/);
assert.match(result.context, /첨부 이미지 OCR 답변 지침/);
assert.match(result.context, /첨부 이미지 OCR 결과/);
assert.match(result.context, /selectbox1/);
assert.match(result.context, /파일이 암호화되어 있습니다/);
assert.match(result.context, /OCR 사용법이나 OCR의 한계를 설명하는 답변으로 시작하지 마십시오/);
assert.match(result.context, /오류 문구 기준의 원인과 조치부터 답변/);
assert.doesNotMatch(result.context, /fake image bytes/);
assert.doesNotMatch(result.context, /fake jpg bytes/);
assert.match(result.policyText, /첨부 이미지 OCR 분석 내용 포함/);
assert.match(result.policyText, /OCR 결과가 문의와 관련 있으면/);
assert.match(result.policyText, /이미지 첨부 OCR 미수행/);
assert.match(result.policyText, /위험 첨부 제외/);

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
