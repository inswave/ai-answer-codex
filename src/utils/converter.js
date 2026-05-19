/**
 * 메일 스레드 → Q&A 변환 유틸리티
 */

/**
 * 메일 스레드를 Q&A 형태로 변환
 * 첫 메일 = 질문, 이후 메일 = 답변으로 처리
 *
 * @param {Array} thread - 시간순 정렬된 메일 배열
 * @returns {object|null} - { question, answer, source, date, ... }
 */
// 기술문의가 아닌 메일 제목 패턴 (건너뜀)
const SKIP_PATTERNS = [
  /정기\s*점검/i,
  /분기\s*점검/i,
  /보고서\s*전달/i,
  /점검\s*보고/i,
  /회의\s*록/i,
  /회의\s*안내/i,
  /공지\s*사항/i,
  /휴가/i,
  /부재중/i,
  /out\s*of\s*office/i,
  /자동\s*응답/i,
  /auto[\s-]*reply/i,
  /견적/i,
  /계약/i,
  /청구/i,
  /세금계산서/i,
  /연말정산/i,
];
const BLOCKED_ATTACHMENT_EXT = new Set(['.ellicense', '.license', '.lic', '.key']);
const BLOCKED_ATTACHMENT_NAME = /license|licence|라이선스|라이센스/i;

function isBlockedAttachment(filename) {
  const name = String(filename || '');
  const extMatch = name.match(/(\.[^.]+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';
  return BLOCKED_ATTACHMENT_EXT.has(ext) || BLOCKED_ATTACHMENT_NAME.test(name);
}

function convertToQA(thread) {
  if (!thread || thread.length === 0) return null;

  const firstMail = thread[0];
  const subject = firstMail.subject || '';

  // 비기술 메일 건너뛰기
  if (SKIP_PATTERNS.some((p) => p.test(subject))) return null;

  // 스레드 전체 본문을 합쳐서 저장 (Q&A 분리 없이)
  const allParts = thread.map((mail) => cleanText(mail.text || ''));
  const fullText = allParts.filter((t) => t.length > 0).join('\n\n---\n\n');

  if (!fullText || fullText.length < 10) return null;

  // 스레드 모든 메일의 첨부파일 메타데이터 수집 (실물은 saveAttachments에서 디스크에 저장)
  const attachments = [];
  for (const mail of thread) {
    if (!Array.isArray(mail.attachments)) continue;
    for (const att of mail.attachments) {
      if (!att.filename) continue;
      if (isBlockedAttachment(att.filename)) continue;
      attachments.push({
        filename: att.filename,
        mimeType: att.contentType || '',
        size: att.size || 0,
      });
    }
  }

  // 첨부 폴더 경로 (data/raw/ 기준 상대경로). saveAttachments 명명 규칙과 동일
  let attachmentDir = '';
  if (attachments.length > 0) {
    const dateStr = firstMail.date ? firstMail.date.split('T')[0] : 'unknown';
    const safeSubject = (firstMail.subject || 'no-subject')
      .replace(/[<>:"/\\|?*\[\]]/g, '_')
      .substring(0, 50)
      .trim();
    attachmentDir = `gmail_attachments/${dateStr}_${safeSubject}`;
  }

  const result = {
    category: '',
    subcategory: '',
    question: subject,
    answer: fullText,
    source: 'Gmail 기술문의',
    date: firstMail.date || '',
    tags: extractTags(subject + ' ' + fullText),
  };

  if (attachments.length > 0) {
    result.attachments = attachments;
    result.attachmentDir = attachmentDir;
  }

  return result;
}

/**
 * 텍스트 정리 (인용, 서명 제거)
 */
function cleanText(text) {
  if (!text) return '';

  return text
    // 인용 라인 제거
    .replace(/^>.*$/gm, '')
    // 이메일 서명 제거 (-- 이후)
    .replace(/\n--\s*\n[\s\S]*$/m, '')
    // 전달 헤더 제거
    .replace(/^-{3,}\s*Forwarded message[\s\S]*?^-{3,}/gm, '')
    // 연속 빈 줄 축소
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 질문에서 키워드 태그 추출
 */
function extractTags(text) {
  const tagPatterns = [
    /gridview/i, /grid/i, /엑셀/i, /excel/i,
    /selectbox/i, /calendar/i, /input/i,
    /popup/i, /tab/i, /dataset/i,
    /submission/i, /ajax/i,
    /라이선스/i, /license/i,
    /보안/i, /xss/i,
    /servlet/i, /jakarta/i,
    /poi/i, /업로드/i, /다운로드/i,
  ];

  const tags = [];
  for (const pattern of tagPatterns) {
    if (pattern.test(text)) {
      tags.push(pattern.source.replace(/\\/g, ''));
    }
  }
  return tags;
}

module.exports = { convertToQA, cleanText, extractTags };
