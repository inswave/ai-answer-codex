const path = require('path');
const { sanitize } = require('../utils/sanitize');
const { maskSensitiveInfo } = require('../utils/masking');

const MAX_ATTACHMENT_CHARS = 8000;
const MAX_TOTAL_CHARS = 16000;

const TEXT_EXTENSIONS = new Set(['.xml', '.js', '.css', '.html', '.htm', '.txt', '.md']);
const IMAGE_META_EXTENSIONS = new Set(['.png']);
const BLOCKED_EXTENSIONS = new Set([
  '.zip', '.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.scr', '.com', '.vbs', '.dll',
]);
const UNSUPPORTED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']);
const RISKY_NAME_PATTERN = /license|licence|라이선스|라이센스|key|secret|cert|인증서|계약|보안|password|passwd|pwd/i;

function normalizeAttachment(raw, index) {
  const filename = path.basename(String(raw?.filename || raw?.name || `attachment-${index + 1}`));
  const ext = path.extname(filename).toLowerCase();
  const size = Number(raw?.size || 0);
  const mimeType = String(raw?.mimeType || raw?.contentType || '');
  return { filename, ext, size, mimeType, raw };
}

function getAttachmentText(raw) {
  const value = raw?.text ?? raw?.content ?? raw?.data;
  if (typeof value !== 'string') return '';

  if (String(raw?.encoding || '').toLowerCase() === 'base64') {
    try {
      return Buffer.from(value, 'base64').toString('utf8');
    } catch {
      return '';
    }
  }

  return value;
}

function cleanAttachmentText(rawText, ext) {
  const text = String(rawText || '');
  const cleaned = ext === '.html' || ext === '.htm'
    ? sanitize(text)
    : text
      .replace(/\u00a0/g, ' ')
      .replace(/\u200b/g, '')
      .replace(/\r/g, '')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();

  return maskSensitiveInfo(cleaned);
}

function summarizeMeta(items) {
  if (items.length === 0) return '첨부파일 없음';

  const counts = items.reduce((acc, item) => {
    const key = item.ext || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts)
    .map(([ext, count]) => `${ext}:${count}`)
    .join(', ');
}

function buildQuestionAttachmentContext(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return {
      hasAttachments: false,
      context: '',
      policyText: '',
      summary: { total: 0, byExtension: {}, analyzedTextCount: 0, imageOnlyCount: 0, blockedCount: 0, unsupportedCount: 0 },
      items: [],
    };
  }

  const normalized = attachments.map(normalizeAttachment);
  const analyzed = [];
  const imageOnly = [];
  const blocked = [];
  const unsupported = [];
  let totalChars = 0;

  for (const item of normalized) {
    const risky = RISKY_NAME_PATTERN.test(item.filename);
    if (risky || BLOCKED_EXTENSIONS.has(item.ext)) {
      blocked.push({
        type: 'blocked',
        ext: item.ext,
        size: item.size,
        reason: risky ? 'risky_filename' : 'blocked_extension',
      });
      continue;
    }

    if (TEXT_EXTENSIONS.has(item.ext)) {
      const rawText = getAttachmentText(item.raw);
      if (!rawText.trim()) {
        unsupported.push({ type: 'unsupported', ext: item.ext, size: item.size, reason: 'empty_text' });
        continue;
      }

      const remaining = Math.max(0, MAX_TOTAL_CHARS - totalChars);
      if (remaining === 0) {
        unsupported.push({ type: 'unsupported', ext: item.ext, size: item.size, reason: 'total_text_limit' });
        continue;
      }

      const limit = Math.min(MAX_ATTACHMENT_CHARS, remaining);
      const cleanedText = cleanAttachmentText(rawText, item.ext);
      const safeText = cleanedText.slice(0, limit);
      totalChars += safeText.length;
      analyzed.push({
        type: 'text',
        ext: item.ext,
        size: item.size,
        content: safeText,
        truncated: safeText.length < cleanedText.length,
      });
      continue;
    }

    if (IMAGE_META_EXTENSIONS.has(item.ext)) {
      imageOnly.push({
        type: 'image_meta',
        ext: item.ext,
        size: item.size,
        reason: 'image_content_not_analyzed',
      });
      continue;
    }

    if (UNSUPPORTED_EXTENSIONS.has(item.ext)) {
      unsupported.push({ type: 'unsupported', ext: item.ext, size: item.size, reason: 'unsupported_document_type' });
      continue;
    }

    unsupported.push({ type: 'unsupported', ext: item.ext, size: item.size, reason: 'unsupported_extension' });
  }

  const byExtension = normalized.reduce((acc, item) => {
    const key = item.ext || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const lines = [
    '## 고객 첨부파일 정보',
    '',
    `- 첨부 개수: ${normalized.length}`,
    `- 확장자 요약: ${summarizeMeta(normalized)}`,
    `- 내용 분석 포함: ${analyzed.length}건`,
    `- 이미지 첨부(PNG, 내용 분석 미지원): ${imageOnly.length}건`,
    `- 제외/차단: ${blocked.length}건`,
    `- 미지원 형식: ${unsupported.length}건`,
  ];

  if (imageOnly.length > 0) {
    lines.push('', 'PNG 화면 캡처가 첨부되어 있습니다. 현재 백엔드는 이미지 내용 분석은 수행하지 않으므로 화면 캡처 기준 확인이 필요할 수 있습니다.');
  }

  if (blocked.length > 0) {
    lines.push('', '라이선스/키/계약/실행 파일 등 위험 가능성이 있는 첨부가 제외되었습니다. 해당 첨부 내용은 AI 답변 생성에 사용하지 않습니다.');
  }

  if (analyzed.length > 0) {
    lines.push('', '## 첨부파일 분석 내용');
    analyzed.forEach((item, index) => {
      lines.push('', `[첨부 ${index + 1} ${item.ext}]`, '```', item.content, '```');
    });
  }

  const policyParts = [
    imageOnly.length > 0 ? 'PNG 이미지 첨부 화면 캡처 추가 확인 필요' : '',
    blocked.length > 0 ? '라이선스 키 계약 위험 첨부 제외 담당자 확인 필요' : '',
    analyzed.length > 0 ? '첨부 텍스트 분석 내용 포함' : '',
  ].filter(Boolean);

  return {
    hasAttachments: true,
    context: lines.join('\n'),
    policyText: policyParts.join('\n'),
    summary: {
      total: normalized.length,
      byExtension,
      analyzedTextCount: analyzed.length,
      imageOnlyCount: imageOnly.length,
      blockedCount: blocked.length,
      unsupportedCount: unsupported.length,
    },
    items: [...analyzed, ...imageOnly, ...blocked, ...unsupported].map(({ content, ...item }) => item),
  };
}

module.exports = {
  buildQuestionAttachmentContext,
  TEXT_EXTENSIONS,
  IMAGE_META_EXTENSIONS,
};
