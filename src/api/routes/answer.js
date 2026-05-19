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
const { sanitize } = require('../../utils/sanitize');

const router = express.Router();
const pipeline = new AnswerPipeline();

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
      sources: toSources(cases),
      sampleFiles: toSampleFiles(cases),
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

  if (!originalQuestion || !previousAnswer || !followUp) {
    return res.status(400).json({
      error: 'originalQuestion, previousAnswer, followUp 모두 필요합니다.',
    });
  }

  try {
    const result = await pipeline.processFollowUp(
      { originalQuestion, previousAnswer, followUp },
      { version, topK: topK || 8, attachments }
    );

    const cases = filterRagCases(result.ragResults.cases || []);
    res.json({
      answer: result.answer || '',
      confidence: calculateConfidence(cases),
      sources: toSources(cases),
      sampleFiles: toSampleFiles(cases),
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
      sources: toSources(cases),
      sampleFiles: toSampleFiles(cases),
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
