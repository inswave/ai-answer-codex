#!/usr/bin/env node
/**
 * queryRefinement 단위 테스트
 * - extractEntities, evaluateRagConfidence, buildRefinementCandidates, mergeRagCases
 */

const assert = require('assert');
const {
  extractEntities,
  evaluateRagConfidence,
  buildRefinementCandidates,
  mergeRagCases,
} = require('../src/generator/queryRefinement');

// 1. extractEntities — 컴포넌트/API/행위/버전 추출
{
  const q = 'gridView에서 advancedExcelDownload 호출 시 셀 병합이 풀립니다. AI 버전.';
  const e = extractEntities(q);
  assert(e.components.includes('gridView'), 'should detect gridView');
  assert(e.apis.includes('advancedExcelDownload'), 'should detect advancedExcelDownload');
  assert(e.actions.length > 0, 'should detect action keywords');
  assert.strictEqual(e.version, 'AI', 'should detect AI version');
}

// 2. extractEntities — 컴포넌트 없는 케이스
{
  const q = '교육 일정 안내 부탁드립니다.';
  const e = extractEntities(q);
  assert.strictEqual(e.components.length, 0);
  assert.strictEqual(e.apis.length, 0);
}

// 3. evaluateRagConfidence — 결과 없음 → score 0
{
  const conf = evaluateRagConfidence({ cases: [] }, {});
  assert.strictEqual(conf.score, 0);
  assert.strictEqual(conf.signals.shouldRefine, true);
}

// 4. evaluateRagConfidence — 고품질 결과 (공식 문서 + 키워드 매칭)
{
  const entities = extractEntities('gridView 엑셀 다운로드');
  const cases = [
    {
      match: 85,
      source: 'WebSquare API Guide (AI)',
      title: 'gridView.advancedExcelDownload',
      content: 'gridView 엑셀 다운로드 옵션',
    },
    {
      match: 70,
      source: 'WebSquare 개발 가이드 (AI)',
      title: '엑셀 다운로드 가이드',
      content: 'gridView excel options',
    },
    {
      match: 65,
      source: 'W-Tech QNA',
      title: '엑셀 다운로드 문의',
      content: '엑셀 다운로드',
    },
  ];
  const conf = evaluateRagConfidence({ cases }, entities);
  assert(conf.score >= 0.6, `high quality should pass threshold, got ${conf.score}`);
  assert.strictEqual(conf.signals.shouldRefine, false);
}

// 5. evaluateRagConfidence — 저품질 (Gmail만, 매칭 없음)
{
  const entities = extractEntities('gridView footer 조건 제어');
  const cases = [
    { match: 50, source: 'Gmail 기술문의', title: '관련 없는 문의', content: 'lorem ipsum' },
    { match: 45, source: 'Gmail 기술문의', title: '다른 주제', content: 'other text' },
  ];
  const conf = evaluateRagConfidence({ cases }, entities);
  assert(conf.score < 0.6, `low quality should not pass threshold, got ${conf.score}`);
  assert.strictEqual(conf.signals.shouldRefine, true);
  assert.strictEqual(conf.signals.needsOfficialBoost, true);
}

// 6. buildRefinementCandidates — 엔티티 풍부
{
  const q = 'gridView footer row 조건에 따른 제어';
  const entities = extractEntities(q);
  const conf = { score: 0.3, signals: { shouldRefine: true, needsOfficialBoost: true } };
  const cands = buildRefinementCandidates(q, entities, conf);
  assert(cands.length >= 1, 'should produce at least 1 candidate');
  assert(cands.some((c) => c.strategy === 'entity-compact' || c.strategy === 'official-boost'),
    'should include compact or official boost strategy');
}

// 7. mergeRagCases — 중복 제거 + 순서 보존
{
  const primary = [
    { title: 'A', source: 'src1', content: 'aaa' },
    { title: 'B', source: 'src2', content: 'bbb' },
  ];
  const secondary = [[
    { title: 'B', source: 'src2', content: 'bbb' }, // 중복
    { title: 'C', source: 'src3', content: 'ccc' },
  ]];
  const merged = mergeRagCases(primary, secondary);
  assert.strictEqual(merged.length, 3, 'duplicate should be removed');
  assert.strictEqual(merged[0].title, 'A');
  assert.strictEqual(merged[1].title, 'B');
  assert.strictEqual(merged[2].title, 'C');
  assert.strictEqual(merged[2].fromRefinement, true, 'secondary new case marked');
}

// 8. mergeRagCases — secondary 비었을 때
{
  const primary = [{ title: 'A', source: 'src1' }];
  const merged = mergeRagCases(primary, []);
  assert.strictEqual(merged.length, 1);
}

console.log('queryRefinement tests passed');
