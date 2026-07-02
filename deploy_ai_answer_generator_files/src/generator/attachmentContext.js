const path = require('path');
const { sanitize } = require('../utils/sanitize');
const { maskSensitiveInfo } = require('../utils/masking');

const MAX_ATTACHMENT_CHARS = 8000;
const MAX_TOTAL_CHARS = 16000;

const TEXT_EXTENSIONS = new Set(['.xml', '.js', '.css', '.html', '.htm', '.txt', '.md']);
const IMAGE_META_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg']);
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

function hasImagePayload(raw) {
  const encoding = String(raw?.encoding || '').toLowerCase();
  const data = raw?.data ?? raw?.content;
  return encoding === 'base64' && typeof data === 'string' && data.trim().length > 0;
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
      summary: {
        total: 0,
        byExtension: {},
        analyzedTextCount: 0,
        imageOnlyCount: 0,
        imagePayloadCount: 0,
        imageOcrCount: 0,
        ocrFailedCount: 0,
        blockedCount: 0,
        unsupportedCount: 0,
      },
      items: [],
    };
  }

  const normalized = attachments.map(normalizeAttachment);
  const analyzed = [];
  const imageItems = [];
  const imageOcr = [];
  const blocked = [];
  const unsupported = [];
  let totalChars = 0;

  for (const item of normalized) {
    const risky = RISKY_NAME_PATTERN.test(item.filename);
    if (risky || BLOCKED_EXTENSIONS.has(item.ext)) {
      blocked.push({
        type: 'blocked',
        filename: item.filename,
        ext: item.ext,
        size: item.size,
        reason: risky ? 'risky_filename' : 'blocked_extension',
      });
      continue;
    }

    if (TEXT_EXTENSIONS.has(item.ext)) {
      const rawText = getAttachmentText(item.raw);
      if (!rawText.trim()) {
        unsupported.push({ type: 'unsupported', filename: item.filename, ext: item.ext, size: item.size, reason: 'empty_text' });
        continue;
      }

      const remaining = Math.max(0, MAX_TOTAL_CHARS - totalChars);
      if (remaining === 0) {
        unsupported.push({ type: 'unsupported', filename: item.filename, ext: item.ext, size: item.size, reason: 'total_text_limit' });
        continue;
      }

      const limit = Math.min(MAX_ATTACHMENT_CHARS, remaining);
      const cleanedText = cleanAttachmentText(rawText, item.ext);
      const safeText = cleanedText.slice(0, limit);
      totalChars += safeText.length;
      analyzed.push({
        type: 'text',
        filename: item.filename,
        ext: item.ext,
        size: item.size,
        content: safeText,
        truncated: safeText.length < cleanedText.length,
      });
      continue;
    }

    if (IMAGE_META_EXTENSIONS.has(item.ext)) {
      const hasPayload = hasImagePayload(item.raw);
      const ocrStatus = String(item.raw?.ocrStatus || '');
      const ocrText = cleanAttachmentText(item.raw?.ocrText || '', '.txt');

      if (ocrText) {
        const remaining = Math.max(0, MAX_TOTAL_CHARS - totalChars);
        const safeText = ocrText.slice(0, Math.min(MAX_ATTACHMENT_CHARS, remaining));
        totalChars += safeText.length;
        imageOcr.push({
          type: 'image_ocr',
          filename: item.filename,
          ext: item.ext,
          size: item.size,
          mimeType: item.mimeType,
          hasPayload,
          ocrStatus: ocrStatus || 'ok',
          content: safeText,
          truncated: safeText.length < ocrText.length,
        });
      }

      imageItems.push({
        type: ocrText ? 'image_ocr' : (hasPayload ? 'image_payload' : 'image_meta'),
        filename: item.filename,
        ext: item.ext,
        size: item.size,
        mimeType: item.mimeType,
        hasPayload,
        ocrStatus,
        reason: ocrText
          ? 'ocr_text_extracted'
          : (hasPayload ? `ocr_${ocrStatus || 'not_run'}` : 'image_content_not_analyzed'),
      });
      continue;
    }

    if (UNSUPPORTED_EXTENSIONS.has(item.ext)) {
      unsupported.push({ type: 'unsupported', filename: item.filename, ext: item.ext, size: item.size, reason: 'unsupported_document_type' });
      continue;
    }

    unsupported.push({ type: 'unsupported', filename: item.filename, ext: item.ext, size: item.size, reason: 'unsupported_extension' });
  }

  const byExtension = normalized.reduce((acc, item) => {
    const key = item.ext || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const imagePayloadCount = imageItems.filter(item => item.hasPayload).length;
  const ocrFailedCount = imageItems.filter(item =>
    item.hasPayload && item.ocrStatus && !['ok', 'empty'].includes(item.ocrStatus)
  ).length;

  const lines = [
    '## 고객 첨부파일 정보',
    '',
    `- 첨부 개수: ${normalized.length}`,
    `- 확장자 요약: ${summarizeMeta(normalized)}`,
    `- 텍스트 분석 포함: ${analyzed.length}건`,
    `- 이미지 첨부: ${imageItems.length}건(이미지 데이터 수신 ${imagePayloadCount}건, OCR 성공 ${imageOcr.length}건)`,
    `- 제외/차단: ${blocked.length}건`,
    `- 미지원 형식: ${unsupported.length}건`,
  ];

  if (imageItems.length > 0) {
    const metaOnlyCount = imageItems.length - imagePayloadCount;
    lines.push(
      '',
      `이미지 첨부가 ${imageItems.length}건 포함되어 있습니다. 이미지 데이터 수신 ${imagePayloadCount}건, 메타데이터만 수신 ${metaOnlyCount}건입니다.`,
      imageOcr.length > 0
        ? `이미지 OCR 결과 ${imageOcr.length}건이 첨부 컨텍스트에 포함되었습니다. OCR 결과는 화면 텍스트 추정값이므로 원본 캡처와 함께 확인하십시오.`
        : '이미지 OCR 결과가 없으므로 이미지 안의 오류 문구나 화면 상태는 근거로 확정하지 마십시오.',
      ocrFailedCount > 0 ? `OCR 실패 또는 처리 제외: ${ocrFailedCount}건` : ''
    );
  }

  if (blocked.length > 0) {
    lines.push('', '라이선스/키/계약/실행 파일 등 위험 가능성이 있는 첨부는 제외했습니다. 해당 첨부 내용은 AI 답변 생성에 사용하지 않습니다.');
  }

  if (analyzed.length > 0) {
    lines.push('', '## 첨부파일 분석 내용');
    analyzed.forEach((item, index) => {
      lines.push('', `[첨부 ${index + 1} ${item.filename}]`, '```', item.content, '```');
    });
  }

  if (imageOcr.length > 0) {
    lines.push(
      '',
      '## 첨부 이미지 OCR 활용 지침',
      '- OCR 결과가 문의 내용과 관련 있으면 답변 본문에서 "첨부 이미지에서 확인되는 내용 기준" 또는 자연스러운 표현으로 먼저 반영하십시오.',
      '- OCR로 읽힌 오류 문구, 함수명, 속성명, 코드 조각은 답변의 확인 근거로 우선 검토하십시오.',
      '- OCR 결과가 불완전해 보이면 단정하지 말고 원본 캡처 확인이 필요하다고 짧게 덧붙이십시오.',
      '- OCR 결과가 있는데도 일반론만 답하지 말고, OCR에서 확인한 핵심 문구를 최소 1회 요약하십시오.'
    );

    lines.push('', '## 첨부 이미지 OCR 결과');
    imageOcr.forEach((item, index) => {
      lines.push('', `[이미지 ${index + 1} ${item.filename}]`, '```', item.content, '```');
    });
  }

  const policyParts = [
    imageOcr.length > 0 ? '첨부 이미지 OCR 분석 내용 포함' : '',
    imageOcr.length > 0 ? 'OCR 결과가 문의와 관련 있으면 답변 본문에 핵심 문구를 반영' : '',
    imageItems.length > imageOcr.length ? '이미지 첨부 OCR 미수행 화면 캡처 추가 확인 필요' : '',
    blocked.length > 0 ? '라이선스 및 계약 위험 첨부 제외 해당성 확인 필요' : '',
    analyzed.length > 0 ? '첨부 텍스트 분석 내용 포함' : '',
  ].filter(Boolean);

  return {
    hasAttachments: true,
    context: lines.filter(line => line !== '').join('\n'),
    policyText: policyParts.join('\n'),
    summary: {
      total: normalized.length,
      byExtension,
      analyzedTextCount: analyzed.length,
      imageOnlyCount: imageItems.length,
      imagePayloadCount,
      imageOcrCount: imageOcr.length,
      ocrFailedCount,
      blockedCount: blocked.length,
      unsupportedCount: unsupported.length,
    },
    items: [...analyzed, ...imageOcr, ...imageItems, ...blocked, ...unsupported].map(({ content, ...item }) => item),
  };
}

module.exports = {
  buildQuestionAttachmentContext,
  TEXT_EXTENSIONS,
  IMAGE_META_EXTENSIONS,
};
