#!/usr/bin/env node
/**
 * AI 답변 품질 평가 스크립트
 *
 * 입력: data/eval/latest_wtech_20.json (eval_collect_latest_wtech.js 결과)
 * 처리: 각 문의에 대해 AnswerPipeline.process() 실행
 * 출력: docs/answer-test-results/{timestamp}_wtech_eval.{json,md}
 *       - 인간 답변 vs AI 답변 side-by-side
 *       - 자동 metric: 길이, sources, 검증경고, self-match 등
 */

const fs = require('fs');
const path = require('path');
const AnswerPipeline = require('../src/generator/pipeline');

function parseArgs(argv) {
  const args = {
    input: path.resolve(__dirname, '../data/eval/latest_wtech_20.json'),
    outDir: path.resolve(__dirname, '../docs/answer-test-results'),
    limit: 0, // 0 = all
    topK: 8,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') args.input = path.resolve(argv[++i]);
    else if (a === '--out-dir') args.outDir = path.resolve(argv[++i]);
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--topK') args.topK = Number(argv[++i]);
  }
  return args;
}

function tsStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
  ].join('-') + '_' + [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join('');
}

function joinComments(comments) {
  return (comments || [])
    .map((c) => (c.content || '').trim())
    .filter(Boolean)
    .join('\n\n---\n\n');
}

// 단순 토큰 기반 자카드 (한국어 보호: 2글자 이상 토큰만)
function tokens(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_.]+/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2)
  );
}

function jaccard(aText, bText) {
  const a = tokens(aText);
  const b = tokens(bText);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// 답변에서 API/속성 후보 추출 (휴리스틱)
function extractApiCandidates(text) {
  const set = new Set();
  const patterns = [
    /\b([a-z][a-zA-Z0-9]+)\s*\(/g, // funcName(
    /\b([A-Z][a-zA-Z0-9]+)\.([a-zA-Z][a-zA-Z0-9]+)/g, // ClassName.member
    /\b(set|get|on)[A-Z][a-zA-Z0-9]+/g, // set/get/on 접두
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      const tok = m[0].replace(/\s*\($/, '');
      if (tok.length >= 4) set.add(tok);
    }
  }
  return [...set];
}

// AI가 검색한 RAG 결과가 평가 대상 문의 자신과 매칭됐는지 (self-match) 판별
function detectSelfMatch(item, ragCases) {
  const itemQ = (item.question || '').slice(0, 80).replace(/\s+/g, ' ').trim();
  if (!itemQ) return null;
  const hit = (ragCases || []).find((c) => {
    const cq = String(c.question || c.metadata?.question || '').slice(0, 80).replace(/\s+/g, ' ').trim();
    return cq === itemQ;
  });
  return hit ? { matched: true, similarity: hit.similarity } : { matched: false };
}

function summarizeRagSources(cases) {
  const counts = {};
  for (const c of cases || []) {
    const src = (c.source || c.metadata?.source || 'unknown').split('(')[0].trim();
    counts[src] = (counts[src] || 0) + 1;
  }
  return counts;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!fs.existsSync(args.input)) {
    console.error(`Input not found: ${args.input}`);
    console.error('Run: node scripts/eval_collect_latest_wtech.js --limit 20 --output ./data/eval/latest_wtech_20.json');
    process.exit(1);
  }

  const evalSet = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  const items = (evalSet.items || []).slice(0, args.limit || evalSet.items.length);
  console.log(`[eval] items=${items.length} input=${args.input}`);

  const pipeline = new AnswerPipeline();
  const results = [];
  const startedAt = new Date();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const humanAnswer = joinComments(item.comments);
    const start = Date.now();
    console.log(`\n[${i + 1}/${items.length}] num=${item.num} title="${(item.title || '').slice(0, 60)}"`);

    let result, error;
    try {
      result = await pipeline.process(item.question, { topK: args.topK });
    } catch (err) {
      error = err.message;
      console.warn(`  FAILED: ${err.message}`);
    }
    const elapsedMs = Date.now() - start;

    if (result) {
      const cases = result.ragResults?.cases || [];
      const selfMatch = detectSelfMatch(item, cases);
      const aiAnswer = String(result.answer || '');
      const overlap = jaccard(aiAnswer, humanAnswer);
      const aiApis = extractApiCandidates(aiAnswer);
      const humanApis = extractApiCandidates(humanAnswer);
      const sharedApis = aiApis.filter((a) => humanApis.includes(a));

      results.push({
        index: i + 1,
        num: item.num,
        title: item.title,
        date: item.date,
        category: item.category,
        product: item.product,
        question: item.question,
        humanAnswer,
        humanCommentCount: item.commentCount,
        aiAnswer,
        elapsedMs,
        ragResultCount: result.ragResults?.resultCount ?? 0,
        ragSourceCounts: summarizeRagSources(cases),
        selfMatch,
        answerMode: result.answerMode || result.answerPolicy?.answerMode,
        riskLevel: result.riskLevel || result.answerPolicy?.riskLevel,
        needsHumanReview: !!result.needsHumanReview,
        reviewReasons: result.reviewReasons || [],
        unverifiedApis: (result.verification?.unverified || []).map((u) => u.name || u),
        verificationSummary: result.verification?.summary || '',
        overlapJaccard: Number(overlap.toFixed(3)),
        aiApiCount: aiApis.length,
        humanApiCount: humanApis.length,
        sharedApiCount: sharedApis.length,
        sharedApis,
      });
    } else {
      results.push({
        index: i + 1,
        num: item.num,
        title: item.title,
        question: item.question,
        humanAnswer,
        error,
        elapsedMs,
      });
    }
  }

  // 출력
  fs.mkdirSync(args.outDir, { recursive: true });
  const stamp = tsStamp();
  const jsonPath = path.join(args.outDir, `${stamp}_wtech_eval.json`);
  const mdPath = path.join(args.outDir, `${stamp}_wtech_eval.md`);

  fs.writeFileSync(jsonPath, JSON.stringify({
    generatedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    inputFile: path.relative(process.cwd(), args.input).replace(/\\/g, '/'),
    itemCount: items.length,
    results,
  }, null, 2), 'utf8');

  // Markdown 요약
  const succeeded = results.filter((r) => !r.error);
  const avgOverlap = succeeded.length
    ? succeeded.reduce((s, r) => s + (r.overlapJaccard || 0), 0) / succeeded.length
    : 0;
  const selfMatchCount = succeeded.filter((r) => r.selfMatch?.matched).length;
  const lowOverlapCount = succeeded.filter((r) => r.overlapJaccard < 0.05).length;
  const noRagCount = succeeded.filter((r) => r.ragResultCount === 0).length;

  const lines = [
    '# W-Tech 신규 게시글 AI 답변 품질 평가',
    '',
    `- 평가 시작: ${startedAt.toISOString()}`,
    `- 평가 종료: ${new Date().toISOString()}`,
    `- 입력 파일: ${path.relative(process.cwd(), args.input).replace(/\\/g, '/')}`,
    `- 총 평가 건수: ${items.length}`,
    `- 성공: ${succeeded.length} / 실패: ${results.length - succeeded.length}`,
    '',
    '## 전체 지표',
    '',
    `- 평균 Jaccard overlap (AI vs 인간): **${avgOverlap.toFixed(3)}**`,
    `- Self-match (자기 자신을 RAG에서 찾음): ${selfMatchCount}건`,
    `- RAG 결과 0건: ${noRagCount}건`,
    `- 매우 낮은 overlap (<0.05): ${lowOverlapCount}건`,
    '',
    '## 건별 결과',
    '',
    '| # | 번호 | 날짜 | 제목 | RAG | Self | Overlap | 모드 | 위험도 |',
    '|---:|---|---|---|---:|---|---:|---|---|',
    ...succeeded.map((r) => `| ${r.index} | ${r.num} | ${r.date || ''} | ${(r.title || '').slice(0, 40).replace(/\|/g, ' ')} | ${r.ragResultCount} | ${r.selfMatch?.matched ? 'Y' : 'N'} | ${r.overlapJaccard} | ${r.answerMode || ''} | ${r.riskLevel || ''} |`),
    '',
  ];

  // 상세
  for (const r of results) {
    lines.push(`## ${r.index}. ${r.num} — ${r.title || ''}`);
    lines.push('');
    if (r.error) {
      lines.push(`**실패**: ${r.error}`);
      lines.push('');
      continue;
    }
    lines.push(`- 날짜: ${r.date || ''} · 카테고리: ${r.category || ''} · 제품: ${r.product || ''}`);
    lines.push(`- RAG: ${r.ragResultCount}건 · Self-match: ${r.selfMatch?.matched ? `YES (sim=${r.selfMatch.similarity})` : 'no'}`);
    lines.push(`- 답변 모드: ${r.answerMode || ''} · 위험도: ${r.riskLevel || ''} · 검토필요: ${r.needsHumanReview ? 'Y' : 'N'}`);
    lines.push(`- API 후보 매칭: AI=${r.aiApiCount}, 인간=${r.humanApiCount}, 공통=${r.sharedApiCount}`);
    lines.push(`- Jaccard overlap: ${r.overlapJaccard}`);
    lines.push(`- 소요: ${Math.round(r.elapsedMs / 1000)}s`);
    if (r.reviewReasons.length) lines.push(`- 검토사유: ${r.reviewReasons.join(', ')}`);
    if (r.unverifiedApis.length) lines.push(`- 미확인 API: ${r.unverifiedApis.map((u) => u.name || u).join(', ')}`);
    lines.push('');
    lines.push('### 문의');
    lines.push('');
    lines.push('```text');
    lines.push((r.question || '').slice(0, 1200));
    lines.push('```');
    lines.push('');
    lines.push('### 인간 답변');
    lines.push('');
    lines.push((r.humanAnswer || '_(없음)_').slice(0, 3000));
    lines.push('');
    lines.push('### AI 답변');
    lines.push('');
    lines.push((r.aiAnswer || '_(빈 답변)_').slice(0, 3000));
    lines.push('');
  }

  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
  console.log(`\n[eval] json: ${jsonPath}`);
  console.log(`[eval] md  : ${mdPath}`);
  console.log(`[eval] 평균 overlap: ${avgOverlap.toFixed(3)}  self-match: ${selfMatchCount}/${succeeded.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
