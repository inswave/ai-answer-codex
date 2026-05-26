#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const AnswerPipeline = require('../src/generator/pipeline');

const questions = [
  'gridView에서 mergeCells로 셀 병합을 적용하는 기본 사용 방법을 알려주세요.',
  'gridView advancedExcelDownload 실행 시 xlsx 확장자로 다운로드되게 설정하는 방법이 궁금합니다.',
  'submission 요청 timeout 시간을 늘리려면 어디에 어떤 옵션을 설정해야 하나요?',
  'inputCalendar 값을 yyyy-MM-dd 형식으로 화면에 표시하려면 어떻게 설정하나요?',
  'selectBox 항목을 dataList 기준으로 동적으로 바인딩하는 방법을 알려주세요.',
  'dynamicCreate로 컴포넌트를 동적으로 생성할 때 기본 절차와 주의사항을 알려주세요.',
  'wframe에서 부모 화면으로 데이터를 전달하거나 부모 함수를 호출하는 방법이 있나요?',
  'gridView 특정 행이나 셀의 배경색을 조건에 따라 바꾸는 방법을 알려주세요.',
  'WebSquare.util.multipleExcelUpload 사용 시 DRM 적용 파일에서 업로드 오류가 날 때 확인할 점은 무엇인가요?',
  '첨부 이미지에 오류 메시지가 있는 경우 AI 답변에서 OCR 결과를 어떻게 참고해야 하나요?',
];

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
  ].join('-') + '_' + [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join('');
}

function mdEscape(text) {
  return String(text || '').replace(/\r\n/g, '\n').trim();
}

function sourceLine(result) {
  const sources = Array.isArray(result?.sources) ? result.sources : [];
  if (sources.length === 0) return '- 없음';
  return sources.map((source) => `- ${source}`).join('\n');
}

async function main() {
  const pipeline = new AnswerPipeline();
  const startedAt = new Date();
  const results = [];

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const start = Date.now();
    console.log(`[${i + 1}/${questions.length}] ${question}`);

    try {
      const result = await pipeline.process(question, { topK: 8 });
      const elapsedMs = Date.now() - start;
      results.push({ question, result, elapsedMs });
      console.log(`  ok ${Math.round(elapsedMs / 1000)}s, answer ${result.answer.length} chars`);
    } catch (err) {
      const elapsedMs = Date.now() - start;
      results.push({ question, error: err, elapsedMs });
      console.log(`  failed ${Math.round(elapsedMs / 1000)}s: ${err.message}`);
    }
  }

  const outDir = path.join(__dirname, '..', 'docs', 'answer-test-results');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${nowStamp()}_qna_answer_batch.md`);

  const lines = [
    '# AI QNA 답변 테스트 결과',
    '',
    `- 실행 시작: ${startedAt.toISOString()}`,
    `- 실행 종료: ${new Date().toISOString()}`,
    `- 총 문의 수: ${questions.length}`,
    '',
  ];

  results.forEach((item, index) => {
    lines.push(`## ${index + 1}. 문의`);
    lines.push('');
    lines.push(mdEscape(item.question));
    lines.push('');
    lines.push('### 결과 요약');
    lines.push('');

    if (item.error) {
      lines.push(`- 상태: 실패`);
      lines.push(`- 소요 시간: ${Math.round(item.elapsedMs / 1000)}초`);
      lines.push(`- 오류: ${item.error.message}`);
      lines.push('');
      return;
    }

    const result = item.result;
    lines.push(`- 상태: 성공`);
    lines.push(`- 소요 시간: ${Math.round(item.elapsedMs / 1000)}초`);
    lines.push(`- 분류: ${result.classification?.categoryLabel || ''} > ${result.classification?.subcategoryLabel || ''}`);
    lines.push(`- RAG 결과: ${result.ragResults?.resultCount ?? 0}건`);
    lines.push(`- 답변 모드: ${result.answerPolicy?.answerMode || result.answerMode || ''}`);
    lines.push(`- 위험도: ${result.answerPolicy?.riskLevel || result.riskLevel || ''}`);
    lines.push(`- 저장 경로: ${result.savedPath || ''}`);
    lines.push('');
    lines.push('### 참고 소스');
    lines.push('');
    lines.push(sourceLine(result));
    lines.push('');
    lines.push('### 답변');
    lines.push('');
    lines.push(mdEscape(result.answer));
    lines.push('');
  });

  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`\nreport: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
