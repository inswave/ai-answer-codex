/**
 * /api/search 라우트 — RAG 검색 (Claude API 미사용, 저비용/저지연)
 *
 * 입출력 스펙은 /api/answer 와 동일:
 *   요청: { query, topK?, context? }
 *   응답: { answer, confidence, sources: [{title, meta, match, url, type}] }
 */

const express = require('express');
const { execFileSync } = require('child_process');
const path = require('path');
const Classifier = require('../../classifier/classifier');
const {
  parseRagResults,
  toSources,
  toSampleFiles,
  calculateConfidence,
  filterRagCases,
} = require('../../rag/parseRagResults');
const { sanitize } = require('../../utils/sanitize');

const router = express.Router();
const classifier = new Classifier();

const searcherPath = path.join(__dirname, '../../rag/searcher.py');
const pythonPath = process.env.PYTHON_PATH || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe')
  : 'python3');

function runSearch(query, topK, categoryFilter) {
  const args = [searcherPath, query, '--top-k', String(topK || 8)];
  if (categoryFilter) args.push('--category', categoryFilter);

  const output = execFileSync(pythonPath, args, {
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  return filterRagCases(parseRagResults(output));
}

function buildAnswer(cases, query) {
  if (cases.length === 0) {
    return '내부 데이터에서 유사 사례가 확인되지 않았습니다. 담당자가 직접 답변을 작성합니다.';
  }
  const top = cases.slice(0, 3).map((c, i) => `${i + 1}. ${c.title}`).join('\n');
  return `"${query}"에 대해 유사 사례 ${cases.length}건을 찾았습니다.\n\n상위 사례:\n${top}\n\n자세한 내용은 sources를 참고하세요.`;
}

// POST /api/search — 통일 스펙
router.post('/', (req, res) => {
  const { query: rawQuery, topK, context, categoryFilter } = req.body;
  const query = sanitize(rawQuery);

  if (!query) {
    return res.status(400).json({ error: '검색어(query)를 입력해주세요.' });
  }

  // context는 받기만 하고 현재는 무시 (추후 필터링/우선순위에 활용 예정)
  void context;

  try {
    const cases = runSearch(query, topK, categoryFilter);
    res.json({
      answer: buildAnswer(cases, query),
      confidence: calculateConfidence(cases),
      sources: toSources(cases),
      sampleFiles: toSampleFiles(cases),
    });
  } catch (err) {
    console.error('[API /search] 실패:', err.message);
    res.status(500).json({ error: 'RAG 검색 실패', detail: err.message });
  }
});

// POST /api/search/raw — 디버깅용 원본 출력 (분류 + cases + Python 원본 stdout)
router.post('/raw', (req, res) => {
  const { query: rawQuery, topK, categoryFilter } = req.body;
  const query = sanitize(rawQuery);

  if (!query) {
    return res.status(400).json({ error: '검색어(query)를 입력해주세요.' });
  }

  try {
    const classification = classifier.classify({ question: query, answer: '' });
    const args = [searcherPath, query, '--top-k', String(topK || 8)];
    if (categoryFilter) args.push('--category', categoryFilter);

    const output = execFileSync(pythonPath, args, {
      encoding: 'utf8',
      timeout: 180000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });

    const rawCases = parseRagResults(output);
    const cases = filterRagCases(rawCases);
    res.json({
      query,
      classification,
      resultCount: cases.length,
      rawResultCount: rawCases.length,
      cases,
      sampleFiles: toSampleFiles(cases),
      rawCases,
      rawContext: output,
    });
  } catch (err) {
    console.error('[API /search/raw] 실패:', err.message);
    res.status(500).json({ error: 'RAG 검색 실패', detail: err.message });
  }
});

module.exports = router;
