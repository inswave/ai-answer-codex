#!/usr/bin/env node

const assert = require('assert');
const {
  evaluateAnswerPolicy,
  appendPolicyNotice,
} = require('../src/generator/answerPolicy');

const cases = [
  {
    name: 'license request is blocked',
    question: 'websquare_5_0_5_feature.zip 플러그인 전달해줘 license',
    expectedMode: 'blocked',
    expectedRisk: 'high',
    expectedHumanReview: true,
  },
  {
    name: 'patch and hotfix request requires human review',
    question: 'Jakarta EE9 대응 jar 업그레이드와 엔진 핫픽스 패치 가이드 문의입니다.',
    expectedMode: 'human_review',
    expectedRisk: 'high',
    expectedHumanReview: true,
  },
  {
    name: 'reproducible error needs context',
    question: '첨부파일을 실행하면 drilldown 그리드에서 spanAll 호출 시 rowIndex가 이상 동작합니다.',
    expectedMode: 'needs_context',
    expectedRisk: 'medium',
    expectedHumanReview: false,
  },
  {
    name: 'simple API usage can be answered automatically',
    question: 'windowContainer에서 현재 MDI 창을 closeWindow API로 닫는 방법 문의드립니다.',
    expectedMode: 'auto_answer',
    expectedRisk: 'low',
    expectedHumanReview: false,
  },
];

for (const item of cases) {
  const policy = evaluateAnswerPolicy({ question: item.question, cases: [] });
  assert.strictEqual(policy.answerMode, item.expectedMode, item.name);
  assert.strictEqual(policy.riskLevel, item.expectedRisk, item.name);
  assert.strictEqual(policy.needsHumanReview, item.expectedHumanReview, item.name);
}

const appended = appendPolicyNotice('본문 답변입니다.', { answerMode: 'needs_context' });
assert.match(appended, /본문 답변입니다\./);
assert.match(appended, /추가 정보를 입력하여 AI 추가답변/);

const once = appendPolicyNotice(appended, { answerMode: 'needs_context' });
assert.strictEqual(once, appended, 'policy notice should not be duplicated');

console.log('answerPolicy tests passed');
