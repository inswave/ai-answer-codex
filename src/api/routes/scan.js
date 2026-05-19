/**
 * /api/queue/scan 라우트 — W-Tech 신규 문의 감지 + 자동 답변 생성
 * SSE로 진행 상태 실시간 전달
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const WTechCollector = require('../../collectors/wtechCollector');
const AnswerPipeline = require('../../generator/pipeline');
const { addToQueue } = require('../queue');

const router = express.Router();
const CURSOR_PATH = path.join(__dirname, '../../../data/queue-cursor.json');

function readCursor() {
  try {
    if (fs.existsSync(CURSOR_PATH)) {
      return JSON.parse(fs.readFileSync(CURSOR_PATH, 'utf8'));
    }
  } catch {}
  return { lastId: null, lastDate: null };
}

function saveCursor(cursor) {
  fs.writeFileSync(CURSOR_PATH, JSON.stringify(cursor, null, 2), 'utf8');
}

/**
 * POST /api/queue/scan — SSE 스트리밍
 * W-Tech 신규 문의 크롤링 → 답변 생성 → 큐 적재
 */
router.post('/', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const collector = new WTechCollector();
  let pipeline = null;

  try {
    // 1. W-Tech 크롤링
    send('status', { step: 'crawl', message: 'W-Tech 게시판 크롤링 중...' });

    const cursor = readCursor();
    await collector.init();
    const page = await collector.browser.newPage();
    await collector.login(page);

    // 최근 1페이지만 확인 (신규 문의 감지 목적)
    const items = await collector.collectListPage(page, 1);

    // cursor 이후 새 글 필터링
    let newItems = items;
    if (cursor.lastId) {
      const lastIdx = items.findIndex(item => item.id === cursor.lastId);
      if (lastIdx >= 0) {
        newItems = items.slice(0, lastIdx); // lastId 이전(=더 최신) 글들
      }
      // lastId를 못 찾으면 전부 새 글로 간주 (페이지 넘어간 경우)
    }

    // 미답변 글만 필터 (답변이 없는 것)
    const unanswered = [];
    for (const item of newItems) {
      const detail = await collector.collectDetail(page, item);
      if (detail && (!detail.answer || detail.answer.trim().length < 10)) {
        unanswered.push({ listItem: item, detail });
      }
    }

    await collector.close();

    send('status', {
      step: 'crawl_done',
      message: `${newItems.length}건 감지, 미답변 ${unanswered.length}건`,
      newCount: newItems.length,
      unansweredCount: unanswered.length,
    });

    if (unanswered.length === 0) {
      // 커서 업데이트 (새 글이 있었으면)
      if (items.length > 0) {
        saveCursor({ lastId: items[0].id, lastDate: new Date().toISOString() });
      }
      send('done', { message: '신규 미답변 문의가 없습니다.', generated: 0 });
      return res.end();
    }

    // 2. 답변 생성
    pipeline = new AnswerPipeline();
    let generated = 0;

    for (let i = 0; i < unanswered.length; i++) {
      const { listItem, detail } = unanswered[i];

      send('status', {
        step: 'generate',
        message: `답변 생성 중... (${i + 1}/${unanswered.length})`,
        current: i + 1,
        total: unanswered.length,
        question: detail.question.slice(0, 80),
      });

      try {
        const result = await pipeline.process(detail.question, { topK: 8 });

        // 큐에 추가
        addToQueue({
          question: detail.question,
          answer: result.answer,
          classification: result.classification,
          sources: result.sources || [],
          filePath: result.savedPath,
        });

        generated++;

        send('status', {
          step: 'generated',
          message: `${i + 1}/${unanswered.length}건 완료`,
          current: i + 1,
          total: unanswered.length,
        });
      } catch (err) {
        send('error', {
          message: `답변 생성 실패 (${detail.question.slice(0, 40)}...): ${err.message}`,
          current: i + 1,
        });
      }
    }

    // 커서 업데이트
    if (items.length > 0) {
      saveCursor({ lastId: items[0].id, lastDate: new Date().toISOString() });
    }

    send('done', {
      message: `완료! ${generated}건 답변 생성, 검수 큐에 추가됨`,
      generated,
      total: unanswered.length,
    });
  } catch (err) {
    send('error', { message: `스캔 실패: ${err.message}` });
  } finally {
    await collector.close().catch(() => {});
    res.end();
  }
});

/**
 * GET /api/queue/scan/cursor — 현재 커서 상태 조회
 */
router.get('/cursor', (req, res) => {
  res.json(readCursor());
});

module.exports = router;
