#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  parseRagResults,
  filterRagCases,
  toSampleFiles,
  calculateConfidence,
} = require('../src/rag/parseRagResults');
const { sanitize } = require('../src/utils/sanitize');

const DEFAULT_QUERIES = [
  'drilldown 그리드에서 spanAll() 함수 실행시 expression 수식 rowIndex()+1 결과가 이상합니다.',
  'calendar에서 시작일 종료일 범위 선택 시 선택된 기간 색상을 다르게 표현하고 싶습니다.',
  'GridView 셀 병합은 어떻게 하나요?',
  '그리드 엑셀 다운로드 후 업로드 시 substring 오류가 발생합니다.',
  'checkbox 컴포넌트 onclick 이벤트에서 체크 상태를 가져오는 방법 문의드립니다.',
  'openPopup 사용 시 Edge IE 모드에서 경로 오류가 발생합니다.',
  'config.xml에서 radio 컴포넌트 useConfig 설정 방법 문의드립니다.',
  'scheduleCalendar에서 휴일을 표시하는 방법 문의드립니다.',
];

const searcherPath = path.join(__dirname, '../src/rag/searcher.py');
const pythonPath = process.env.PYTHON_PATH || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe')
  : 'python3');

function parseArgs(argv) {
  const args = {
    topK: 8,
    output: path.join(__dirname, '../data/review/search_quality_eval.json'),
    queriesFile: '',
    limit: 0,
    offset: 0,
  };

  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--top-k') args.topK = Number(argv[++i] || args.topK);
    else if (arg === '--output') args.output = argv[++i] || args.output;
    else if (arg === '--queries') args.queriesFile = argv[++i] || '';
    else if (arg === '--limit') args.limit = Number(argv[++i] || 0);
    else if (arg === '--offset') args.offset = Number(argv[++i] || 0);
    else positional.push(arg);
  }

  if (positional[0] && !args.queriesFile) args.queriesFile = positional[0];
  if (positional[1]) args.topK = Number(positional[1]) || args.topK;
  if (positional[2]) args.limit = Number(positional[2]) || args.limit;
  if (positional[3]) args.output = positional[3];

  return args;
}

function loadQueries(filePath) {
  if (!filePath) return DEFAULT_QUERIES;
  const fullPath = path.resolve(filePath);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('queries file must be a JSON array');
  return parsed.map((item) => typeof item === 'string' ? item : item.query).filter(Boolean);
}

function runSearch(query, topK) {
  const output = execFileSync(pythonPath, [searcherPath, query, '--top-k', String(topK)], {
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  return output;
}

function sourceSummary(cases) {
  const counts = {};
  for (const c of cases) {
    counts[c.source] = (counts[c.source] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function evaluateQuery(query, topK) {
  const sanitizedQuery = sanitize(query);
  const rawOutput = runSearch(sanitizedQuery, topK);
  const rawCases = parseRagResults(rawOutput);
  const cases = filterRagCases(rawCases);

  return {
    query: sanitizedQuery,
    rawResultCount: rawCases.length,
    filteredResultCount: cases.length,
    confidence: calculateConfidence(cases),
    sampleFileCount: toSampleFiles(cases).length,
    topSources: sourceSummary(cases.slice(0, 5)),
    topResults: cases.slice(0, 5).map((c) => ({
      rank: c.rank,
      match: c.match,
      source: c.source,
      hasSampleFiles: toSampleFiles([c]).length > 0,
      contentPreview: c.content.slice(0, 160),
    })),
  };
}

function main() {
  const args = parseArgs(process.argv);
  const allQueries = loadQueries(args.queriesFile);
  const queries = args.limit > 0
    ? allQueries.slice(args.offset, args.offset + args.limit)
    : allQueries.slice(args.offset);
  const results = [];

  for (const [index, query] of queries.entries()) {
    console.error(`[eval] ${index + 1}/${queries.length}: ${query.slice(0, 80)}`);
    try {
      results.push(evaluateQuery(query, args.topK));
    } catch (err) {
      results.push({ query, error: err.message });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    topK: args.topK,
    offset: args.offset,
    limit: args.limit || null,
    totalQueryCount: allQueries.length,
    queryCount: queries.length,
    results,
  };

  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    output: path.relative(process.cwd(), path.resolve(args.output)).replace(/\\/g, '/'),
    queryCount: queries.length,
    errors: results.filter((r) => r.error).length,
  }, null, 2));
}

main();
