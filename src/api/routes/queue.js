/**
 * /api/queue 라우트 — 검수 큐 관리
 */

const express = require('express');
const { listQueue, getById, updateStatus, updateAnswer } = require('../queue');

const router = express.Router();

// GET /api/queue?status=pending|approved|rejected|all
router.get('/', (req, res) => {
  const { status } = req.query;
  const items = listQueue(status);
  res.json({
    total: items.length,
    items,
  });
});

// GET /api/queue/:id
router.get('/:id', (req, res) => {
  const item = getById(req.params.id);
  if (!item) {
    return res.status(404).json({ error: '해당 항목을 찾을 수 없습니다.' });
  }
  res.json(item);
});

// PATCH /api/queue/:id — 상태 변경 또는 답변 수정
router.patch('/:id', (req, res) => {
  const { status, answer } = req.body;

  // 답변 수정 (status 없이 answer만 온 경우)
  if (answer !== undefined && !status) {
    const item = updateAnswer(req.params.id, answer);
    if (!item) {
      return res.status(404).json({ error: '해당 항목을 찾을 수 없습니다.' });
    }
    return res.json(item);
  }

  // 상태 변경
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status는 approved 또는 rejected만 가능합니다.' });
  }

  // 답변 수정 + 상태 변경 동시
  if (answer !== undefined) {
    updateAnswer(req.params.id, answer);
  }

  const item = updateStatus(req.params.id, status);
  if (!item) {
    return res.status(404).json({ error: '해당 항목을 찾을 수 없습니다.' });
  }
  res.json(item);
});

module.exports = router;
