/**
 * /api/attachment 라우트 — RAG 사례의 첨부파일 다운로드
 *
 * 사용법:
 *   GET /api/attachment?dir=gmail_attachments/2026-04-13_제목&filename=spec.pdf
 *   GET /api/attachment?dir=dev-guide-sample/GridView/Merge&filename=mergeCells_GridView.xml
 *
 * 보안:
 *   - path traversal 차단 (data/raw/ 안으로만)
 *   - 차단 확장자 (.exe/.bat/.sh/.ps1/.msi/.scr/.cmd/.vbs/.com)
 *   - 파일 크기 제한 (50MB)
 *   - API Key 인증 (config.api.apiKey 설정 시)
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const apiKeyAuth = require('../middleware/auth');

const router = express.Router();

const RAW_DIR = path.resolve(__dirname, '../../../data/raw');
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
const BLOCKED_EXT = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.scr', '.com', '.vbs', '.dll',
]);
const ALLOWED_DIR_PREFIXES = ['dev-guide-sample/'];

function normalizeDir(dir) {
  return String(dir || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function isAllowedAttachmentDir(dir) {
  const normalized = normalizeDir(dir);
  return ALLOWED_DIR_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

// MIME 추정
function guessMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.xml': 'application/xml',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.html': 'text/html',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.zip': 'application/zip',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.md': 'text/markdown',
  };
  return map[ext] || 'application/octet-stream';
}

// 파일 다운로드 (인증 필수)
router.get('/', apiKeyAuth, (req, res) => {
  const { dir, filename } = req.query;

  if (!dir || !filename) {
    return res.status(400).json({ error: 'dir, filename 쿼리 파라미터 필수' });
  }

  if (!isAllowedAttachmentDir(dir)) {
    return res.status(403).json({ error: '허용되지 않은 첨부파일 경로' });
  }

  // 차단 확장자
  const ext = path.extname(filename).toLowerCase();
  if (BLOCKED_EXT.has(ext)) {
    return res.status(403).json({ error: '차단된 파일 형식', extension: ext });
  }

  // path traversal 방어
  const candidate = path.resolve(RAW_DIR, dir, filename);
  if (!candidate.startsWith(RAW_DIR + path.sep) && candidate !== RAW_DIR) {
    return res.status(400).json({ error: '잘못된 경로 (path traversal 차단)' });
  }

  // 파일 존재 확인
  if (!fs.existsSync(candidate)) {
    return res.status(404).json({ error: '파일 없음', path: `${dir}/${filename}` });
  }

  // 크기 제한
  const stat = fs.statSync(candidate);
  if (!stat.isFile()) {
    return res.status(400).json({ error: '파일이 아님' });
  }
  if (stat.size > MAX_SIZE) {
    return res.status(413).json({ error: '파일 크기 초과', size: stat.size, max: MAX_SIZE });
  }

  // 다운로드 응답
  const mimeType = guessMimeType(filename);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  fs.createReadStream(candidate).pipe(res);
});

// GET /api/attachment/list?dir=... — 폴더 안 첨부 파일 목록
router.get('/list', apiKeyAuth, (req, res) => {
  const { dir } = req.query;
  if (!dir) {
    return res.status(400).json({ error: 'dir 쿼리 파라미터 필수' });
  }

  if (!isAllowedAttachmentDir(dir)) {
    return res.status(403).json({ error: '허용되지 않은 첨부파일 경로' });
  }

  const candidate = path.resolve(RAW_DIR, dir);
  if (!candidate.startsWith(RAW_DIR + path.sep)) {
    return res.status(400).json({ error: '잘못된 경로' });
  }
  if (!fs.existsSync(candidate)) {
    return res.status(404).json({ error: '폴더 없음', dir });
  }

  const stat = fs.statSync(candidate);
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: '폴더가 아님' });
  }

  const files = fs.readdirSync(candidate)
    .filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return !BLOCKED_EXT.has(ext);
    })
    .map((f) => {
      const filePath = path.join(candidate, f);
      const fileStat = fs.statSync(filePath);
      if (!fileStat.isFile()) return null;
      return {
        filename: f,
        mimeType: guessMimeType(f),
        size: fileStat.size,
        downloadUrl: `/api/attachment?dir=${encodeURIComponent(dir)}&filename=${encodeURIComponent(f)}`,
      };
    })
    .filter(Boolean);

  res.json({ dir, files, count: files.length });
});

module.exports = router;
