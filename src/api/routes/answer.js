/**
 * /api/answer 라우트 — RAG 검색 + Claude API로 정식 답변 생성
 *
 * 입출력 스펙은 /api/search 와 동일:
 *   요청: { query, topK?, context? }
 *   응답: { answer, confidence, sources: [{title, meta, match, url, type}] }
 */

const express = require('express');
const AnswerPipeline = require('../../generator/pipeline');
const {
  toSources,
  toSampleFiles,
  calculateConfidence,
  filterRagCases,
} = require('../../rag/parseRagResults');
const { findSampleFiles, mergeSampleFiles, shouldIncludeSampleFiles } = require('../../rag/sampleMatcher');
const { sanitize } = require('../../utils/sanitize');

const router = express.Router();
const pipeline = new AnswerPipeline();
const MAX_VISIBLE_SOURCES = 3;

// [2026-06-01] 참고자료 중복 제거
//  - 링크(url) 있는 항목 → 항상 노출(중복 제거 대상 제외)
//  - 링크 없는 항목 → 타입(board/email/wiki 등)당 1개만 (유사도 상위가 먼저라 대표 1건 유지)
//  - 그 다음 최대 MAX_VISIBLE_SOURCES(3)개로 cap
function dedupVisibleSources(sources) {
  const seenLinklessTypes = new Set();
  const out = [];
  for (const s of sources) {
    if (s.url) {
      out.push(s);
    } else {
      if (seenLinklessTypes.has(s.type)) continue;
      seenLinklessTypes.add(s.type);
      out.push(s);
    }
  }
  return out;
}

function toVisibleSources(query, cases) {
  // [2026-06-04] 다운로드 링크는 항상 부착한다. toSources는 isSampleAttachmentCase
  //   (dev-guide-sample/ 출처)에만 첨부를 붙이므로, 질문에 '샘플/예제' 키워드가
  //   없어도 개발가이드 샘플 출처에는 링크가 붙고 다른 출처엔 영향이 없다.
  const all = toSources(cases, { includeAttachments: true });
  return dedupVisibleSources(all).slice(0, MAX_VISIBLE_SOURCES);
}

function buildVisibleSampleFiles(query, cases) {
  if (!shouldIncludeSampleFiles(query)) return [];
  return mergeSampleFiles(findSampleFiles(query, cases), toSampleFiles(cases), 2);
}

// POST /api/answer — 통일 스펙
router.post('/', async (req, res) => {
  // query 우선, question은 하위 호환
  const rawQuery = req.body.query || req.body.question;
  const query = sanitize(rawQuery);
  const { topK, context, categoryFilter, attachments } = req.body;
  // context.engineVersion이 있으면 version 으로 매핑 (하위 호환: req.body.version)
  const version = (context && context.engineVersion) || req.body.version;

  if (!query) {
    return res.status(400).json({ error: '검색어(query)를 입력해주세요.' });
  }

  try {
    const result = await pipeline.process(query, {
      version,
      topK: topK || 8,
      categoryFilter,
      attachments,
    });

    const cases = filterRagCases(result.ragResults.cases || []);
    res.json({
      answer: result.answer || '',
      confidence: calculateConfidence(cases),
      sources: toVisibleSources(query, cases),
      sampleFiles: buildVisibleSampleFiles(query, cases),
      mcp: {
        enabled: !!result.mcpContext?.enabled,
        available: !!result.mcpContext?.available,
        itemCount: result.mcpContext?.items?.length || 0,
      },
      answerMode: result.answerMode,
      riskLevel: result.riskLevel,
      needsHumanReview: result.needsHumanReview,
      reviewReasons: result.reviewReasons || [],
      requiredInfo: result.requiredInfo || [],
      attachmentSummary: result.attachmentContext?.summary,
    });
  } catch (err) {
    console.error('[API /answer] 실패:', err);
    res.status(500).json({ error: '답변 생성 실패', detail: err.message });
  }
});

// POST /api/answer/follow-up — 재답변 (대화 맥락 유지) · 동일 응답 스펙
router.post('/follow-up', async (req, res) => {
  const { originalQuestion, previousAnswer, followUp, topK, context, attachments } = req.body;
  const version = (context && context.engineVersion) || req.body.version;

  if (!originalQuestion || !followUp) {
    return res.status(400).json({
      error: 'originalQuestion, followUp 모두 필요합니다.',
    });
  }

  try {
    const result = await pipeline.processFollowUp(
      { originalQuestion, previousAnswer: previousAnswer || '', followUp },
      { version, topK: topK || 8, attachments }
    );

    const cases = filterRagCases(result.ragResults.cases || []);
    const sampleQuery = sanitize([originalQuestion, followUp].filter(Boolean).join('\n'));
    res.json({
      answer: result.answer || '',
      confidence: calculateConfidence(cases),
      sources: toVisibleSources(sampleQuery, cases),
      sampleFiles: buildVisibleSampleFiles(sampleQuery, cases),
      mcp: {
        enabled: !!result.mcpContext?.enabled,
        available: !!result.mcpContext?.available,
        itemCount: result.mcpContext?.items?.length || 0,
      },
      answerMode: result.answerMode,
      riskLevel: result.riskLevel,
      needsHumanReview: result.needsHumanReview,
      reviewReasons: result.reviewReasons || [],
      requiredInfo: result.requiredInfo || [],
      attachmentSummary: result.attachmentContext?.summary,
    });
  } catch (err) {
    console.error('[API /answer/follow-up] 실패:', err);
    res.status(500).json({ error: '재답변 생성 실패', detail: err.message });
  }
});

// POST /api/answer/stream — SSE 스트리밍 (디버깅/UI용, 스펙 외 형식)
router.post('/stream', async (req, res) => {
  const rawQuery = req.body.query || req.body.question;
  const query = sanitize(rawQuery);
  const { topK, context, categoryFilter, attachments } = req.body;
  const version = (context && context.engineVersion) || req.body.version;

  if (!query) {
    return res.status(400).json({ error: '검색어(query)를 입력해주세요.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send('status', { step: 'classify', message: '문의 분류 중...' });

    const result = await pipeline.process(query, {
      version,
      topK: topK || 8,
      categoryFilter,
      attachments,
    });

    const cases = filterRagCases(result.ragResults.cases || []);
    send('status', { step: 'done', message: '답변 생성 완료' });
    send('result', {
      answer: result.answer || '',
      confidence: calculateConfidence(cases),
      sources: toVisibleSources(query, cases),
      sampleFiles: buildVisibleSampleFiles(query, cases),
      mcp: {
        enabled: !!result.mcpContext?.enabled,
        available: !!result.mcpContext?.available,
        itemCount: result.mcpContext?.items?.length || 0,
      },
      answerMode: result.answerMode,
      riskLevel: result.riskLevel,
      needsHumanReview: result.needsHumanReview,
      reviewReasons: result.reviewReasons || [],
      requiredInfo: result.requiredInfo || [],
      attachmentSummary: result.attachmentContext?.summary,
    });
  } catch (err) {
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});

module.exports = router;
