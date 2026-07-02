#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const AnswerPipeline = require('../src/generator/pipeline');

// Phase 3 (5/27) 새로 추가된 컴포넌트 위주 검증 질문
const questions = [
  'textarea 컴포넌트를 readOnly로 설정하면서 글자 색상도 회색으로 변경하려면 어떻게 하나요?',
  'checkbox 그룹에서 모두 선택/해제 버튼을 구현하려면 어떤 API를 사용해야 하나요?',
  'radio 컴포넌트에서 선택된 값을 가져오는 방법과 onclick 이벤트 처리는 어떻게 하나요?',
  'multiselect 컴포넌트에 dataList로 다수의 항목을 동적으로 바인딩하려면 어떻게 설정하나요?',
  'datePicker 컴포넌트에서 날짜 형식을 yyyy-MM-dd로 설정하고 최대/최소 날짜를 제한하는 방법은?',
  'calendar 컴포넌트로 특정 날짜를 클릭했을 때 일정을 표시하려면 어떤 이벤트를 사용하나요?',
  'fwGaugeChart에 setValue로 값을 설정하고 범위(min, max)를 동적으로 변경하는 방법을 알려주세요.',
  'fwGanttChart에서 task 사이를 connector로 연결하고 milestone을 추가하는 사용 예시를 알려주세요.',
  'mapchart 컴포넌트에서 시도 → 시군구로 drilldown 했을 때 dataList의 색상을 새로 적용하려면?',
  'WebSquare.cookie API로 만료 시간을 설정한 쿠키를 생성하고 읽어오는 방법을 보여주세요.',
  'WebSquare.json.parse를 사용해 JSON 문자열을 안전하게 객체로 변환하는 권장 패턴이 있나요?',
  '$p.data.get("JSON")으로 DataMap/DataList 전체 데이터를 한 번에 가져올 때 nullYNType 설정이 결과에 어떻게 영향을 주나요?',
  'nameLayer 컴포넌트로 보안 처리(블러)를 적용하고 클릭 시 해제하는 방법은?',
  'scrollView 안에 동적으로 추가한 컴포넌트가 스크롤되지 않을 때 확인할 점은 무엇인가요?',
  'gridView 헤더(gridView/header) 셀에 정렬 아이콘과 클릭 이벤트를 추가하려면 어떻게 하나요?',
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
  const outPath = path.join(outDir, `${nowStamp()}_phase3_answer_batch.md`);

  const lines = [
    '# Phase 3 (5/27 추가 컴포넌트) AI 답변 테스트 결과',
    '',
    `- 실행 시작: ${startedAt.toISOString()}`,
    `- 실행 종료: ${new Date().toISOString()}`,
    `- 총 문의 수: ${questions.length}`,
    `- 검증 대상: textarea/checkbox/radio/multiselect/datePicker/calendar/fwGaugeChart/fwGanttChart/mapchart/WebSquare.cookie/WebSquare.json/\$p.data/nameLayer/scrollView/gridView/header`,
    '',
  ];

  results.forEach((item, index) => {
    lines.push(`## ${index + 1}. 문의`);
    lines.push('');
    lines.push(mdEscape(item.question));
    lines.push('');
    lines.push('### 결과 요약');
    if (item.error) {
      lines.push(`- 상태: 실패 (${Math.round(item.elapsedMs / 1000)}s)`);
      lines.push(`- 오류: ${item.error.message}`);
    } else {
      const r = item.result;
      lines.push(`- 상태: 성공 (${Math.round(item.elapsedMs / 1000)}s)`);
      lines.push(`- 분류: ${r.classification?.category || '-'} / ${r.classification?.subCategory || '-'}`);
      lines.push(`- RAG 건수: ${r.ragResults?.length || 0}`);
      lines.push(`- MCP 사용: ${r.mcp?.available ? 'YES (' + (r.mcp.items?.map(x => x.component).join(',') || '') + ')' : 'NO'}`);
      lines.push(`- 출처:`);
      lines.push(sourceLine(r));
      lines.push('');
      lines.push('### 답변');
      lines.push('');
      lines.push('```');
      lines.push(mdEscape(r.answer));
      lines.push('```');
    }
    lines.push('');
  });

  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`\nReport saved: ${outPath}`);
}

main().catch((err) => {
  console.error('Batch failed:', err);
  process.exit(1);
});
