#!/usr/bin/env node
/**
 * 답변 생성 스크립트
 * 사용법: node scripts/answer.js "기술문의 내용" [--version v5.0] [--top-k 8]
 */

const AnswerPipeline = require('../src/generator/pipeline');

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log('사용법: node scripts/answer.js "기술문의 내용" [--version v5.0] [--top-k 8]');
    process.exit(0);
  }

  const question = args[0];
  const options = {};

  const versionIdx = args.indexOf('--version');
  if (versionIdx !== -1) options.version = args[versionIdx + 1];

  const topKIdx = args.indexOf('--top-k');
  if (topKIdx !== -1) options.topK = parseInt(args[topKIdx + 1], 10);

  const pipeline = new AnswerPipeline();
  const result = await pipeline.process(question, options);

  console.log('\n' + '='.repeat(60));
  console.log('분류:', result.classification.categoryLabel, '>', result.classification.subcategoryLabel);
  console.log('RAG 참조:', result.ragResults.resultCount, '건');
  console.log('답변 근거:', result.hasRagResults ? '내부 데이터 기반' : '일반 기술 지식 기반 (내부 사례 없음)');
  console.log('모델:', result.model);
  console.log('토큰:', `입력 ${result.usage.inputTokens} / 출력 ${result.usage.outputTokens}`);
  console.log('API 검증:', result.verification.summary);
  if (result.savedPath) console.log('저장 경로:', result.savedPath);
  console.log('='.repeat(60));

  if (result.verification.verified.length > 0) {
    console.log('\n[✅ 검증된 API]');
    for (const v of result.verification.verified) {
      console.log(`  ${v.name} — ${v.source} (유사도: ${v.score})`);
    }
  }
  if (result.verification.unverified.length > 0) {
    console.log('\n[⚠️ 미확인 API — 실제 존재 여부 확인 필요]');
    for (const u of result.verification.unverified) {
      console.log(`  ${u.name}`);
    }
  }

  console.log('\n[답변 초안]\n');
  console.log(result.answer);
}

main().catch((err) => {
  console.error('답변 생성 실패:', err);
  process.exit(1);
});
