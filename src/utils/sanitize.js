/**
 * 외부 입력(W-Tech 게시글 본문 등) 정제 유틸
 *
 * 처리:
 *  1. HTML 태그 제거
 *  2. 일반적인 HTML 엔티티 디코딩
 *  3. WebSquare 기술문의 게시글의 템플릿 보일러플레이트 섹션 제거
 *     (개요 / 재현 방법 / 추가 정보 또는 예상원인 / 비고 — 안내 문구만 있고 사용자 입력 없을 때)
 *  4. 연속 공백/줄바꿈 정리
 */

const TEMPLATE_HEADERS = [
  '개요',
  '재현 방법',
  '재현방법',
  '추가 정보 또는 예상원인',
  '추가정보 또는 예상원인',
  '추가 정보',
  '예상원인',
  '비고',
];

// 템플릿 안내 문구(이거만 있으면 그 섹션은 빈 섹션)
const TEMPLATE_HINT_PATTERNS = [
  /기능 문의의 경우 해당 기능의 사용 용도와 목적을 구체적으로 기술해 주시기 바랍니다\.?/g,
  /재현이 쉽도록 순서를 명시하여 주시면 좋습니다\.? ?관련 소스는 가급적 첨부파일로 올려 주시기 바랍니다\.?/g,
  /추가로 관련 의심사항이나 예상되는 원인이 있다고 생각되면 말씀해 주십시오\.?/g,
  /파일 업로드 후 \[추가\] 버튼을 누르시면 됩니다\.?/g,
];

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

function stripHtml(text) {
  return text
    // <br>, <br /> → 줄바꿈
    .replace(/<br\s*\/?>/gi, '\n')
    // </p>, </div>, </li> 등 블록 종료 → 줄바꿈
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    // 나머지 모든 태그 제거
    .replace(/<[^>]+>/g, '');
}

function removeTemplateBoilerplate(text) {
  let result = text;
  // 템플릿 안내 문구 제거
  for (const pattern of TEMPLATE_HINT_PATTERNS) {
    result = result.replace(pattern, '');
  }
  // 헤더 비교용 — 공백 모두 제거한 정규화 셋
  const headerKeys = new Set(TEMPLATE_HEADERS.map((h) => h.replace(/\s+/g, '')));
  // 헤더 마커(■, □, *)로 시작하는 줄에서 헤더 단어만 남았으면 제거
  result = result.replace(/^[\s]*[■□*●◆▶][^\n]*$/gm, (line) => {
    const stripped = line.replace(/[\s■□*●◆▶]/g, '');
    return headerKeys.has(stripped) ? '' : line;
  });
  return result;
}

function normalizeWhitespace(text) {
  return text
    .replace(/[ \t]+/g, ' ')           // 연속 공백 → 한 칸
    .replace(/\n[ \t]+/g, '\n')        // 줄 시작 공백 제거
    .replace(/[ \t]+\n/g, '\n')        // 줄 끝 공백 제거
    .replace(/\n{3,}/g, '\n\n')        // 3줄 이상 빈 줄 → 2줄
    .trim();
}

/**
 * 외부 입력 정제 메인 함수
 * @param {string} input - 원본 텍스트 (HTML 포함 가능)
 * @returns {string} - 정제된 평문
 */
function sanitize(input) {
  if (!input || typeof input !== 'string') return '';

  let text = input;
  text = stripHtml(text);
  text = decodeHtmlEntities(text);
  text = removeTemplateBoilerplate(text);
  text = normalizeWhitespace(text);

  return text;
}

module.exports = { sanitize, stripHtml, decodeHtmlEntities, removeTemplateBoilerplate, normalizeWhitespace };
