/**
 * 민감정보 마스킹 유틸리티
 * 외부 AI 요청, 로그, 검수 큐, 답변 파일에 원문 식별 정보가 남지 않도록 정리한다.
 */

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_PATTERNS = [
  /\b0\d{1,2}-\d{3,4}-\d{4}\b/g,
  /\b01[016789]\d{7,8}\b/g,
  /\b\d{2,3}-\d{3,4}-\d{4}\b/g,
];
const IP_PATTERN = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g;
const URL_PATTERN = /https?:\/\/(?:(?!websquare|inswave|w-tech)[a-zA-Z0-9.-]+)\.[a-zA-Z]{2,}[^\s)>\]"]*/gi;
const FILENAME_PATTERN = /[^\s"'<>|\\/:*?]+?\.(?:zip|xml|xlsx?|pdf|docx?|pptx?|png|jpe?g|gif|txt|log|war|jar)\b/gi;

const SECRET_KEY_PATTERN = /\b(api[_-]?key|token|password|passwd|pwd|client[_-]?secret|clientSecret|secret)\b\s*[:=]?\s*["']?[^"'\s,}]+["']?/gi;

const LINE_FIELD_PATTERNS = [
  {
    regex: /((?:회사명\s*\/\s*프로젝트명|회사명|프로젝트명|고객사|고객사명)\s*[:：]?\s*|(?:client|company|project)\s*[:：]\s*)([^\r\n]+)/gi,
    replacement: '$1[고객/프로젝트]',
  },
  // [2026-06-01] 이름 필드 마스킹 제거 — 답변엔 "담당자: 이름" 같은 구조가 나오지 않아 가릴 대상이 없고,
  //   콜론이 선택이라 산문("담당자 확인 후", "담당자가 검토")까지 매칭해 엉뚱한 단어를 [이름]으로 오삽입하던 버그가 있었음.
];

function maskLineFields(text) {
  let masked = text;
  for (const { regex, replacement } of LINE_FIELD_PATTERNS) {
    masked = masked.replace(regex, replacement);
  }
  return masked;
}

/**
 * 민감정보 마스킹
 * @param {string} text - 원본 텍스트
 * @returns {string} - 마스킹된 텍스트
 */
function maskSensitiveInfo(text, options = {}) {
  if (!text || typeof text !== 'string') return '';
  const maskFilenames = options.maskFilenames !== false;

  let masked = text;
  masked = masked.replace(SECRET_KEY_PATTERN, (_, key) => `${key}: [비밀값]`);
  masked = masked.replace(EMAIL_PATTERN, '[이메일]');
  for (const pattern of PHONE_PATTERNS) {
    masked = masked.replace(pattern, '[전화번호]');
  }
  masked = masked.replace(IP_PATTERN, '[서버주소]');
  masked = masked.replace(URL_PATTERN, '[URL]');
  masked = maskLineFields(masked);
  if (maskFilenames) {
    masked = masked.replace(FILENAME_PATTERN, '[첨부파일]');
  }

  return masked;
}

function maskObjectSensitiveInfo(value, options = {}) {
  if (typeof value === 'string') return maskSensitiveInfo(value, options);
  if (Array.isArray(value)) return value.map((item) => maskObjectSensitiveInfo(item, options));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, maskObjectSensitiveInfo(item, options)])
    );
  }
  return value;
}

/**
 * 기존 수집기 호환용 별칭.
 */
function maskPersonalInfo(text) {
  return maskSensitiveInfo(text);
}

module.exports = { maskPersonalInfo, maskSensitiveInfo, maskObjectSensitiveInfo };
