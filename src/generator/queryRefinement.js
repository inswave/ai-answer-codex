/**
 * 질문 보강(Query Refinement) — 다단계 RAG 검색 보조
 *
 * 책임:
 *   1. 1차 RAG 결과의 신뢰도(confidence) 평가
 *   2. 신뢰도 낮을 때 질문에서 엔티티(컴포넌트/API/행위) 추출
 *   3. 보강 검색용 쿼리 후보 생성
 *
 * 답변 생성 LLM은 건드리지 않는다. Pipeline 내부 보조 도구.
 */

// WebSquare 컴포넌트명 사전 (영어 + 한국어 별칭)
// key=영문 정규명, value=매칭 키워드 (한국어 별칭 포함)
const COMPONENT_DICT = {
  gridView: ['gridView', 'gridview', '그리드뷰', '그리드 뷰', '그리드'],
  selectBox: ['selectBox', 'selectbox', '셀렉트박스', '셀렉트 박스'],
  inputCalendar: ['inputCalendar', '캘린더', '달력'],
  inputDate: ['inputDate'],
  input: ['inputBox', 'input '],
  tabControl: ['tabControl', 'tabcontrol', 'tac_layout', '탭컨트롤', '탭 컨트롤', '메뉴탭', '탭'],
  wframe: ['wframe', 'wFrame', 'WFrame', '와이프레임'],
  window: ['window', '윈도우', 'mdi창', 'MDI'],
  group: ['group ', 'group1', 'grp_', '그룹'],
  output: ['output'],
  fileUpload: ['fileUpload', 'multipleUpload', 'multiFileUpload', '파일업로드', '파일 업로드'],
  autoComplete: ['autoComplete', 'autocomplete', 'autocomplate', '자동완성'],
  treeView: ['treeView', '트리뷰', '트리'],
  popup: ['popup', '팝업', 'openPopup'],
  modal: ['modal', '모달'],
  layer: ['layer', '레이어'],
  submission: ['submission', 'submit', '서브미션'],
  dataList: ['dataList', '데이터리스트'],
  dataMap: ['dataMap', '데이터맵'],
  dataset: ['dataset'],
  chart: ['chart', 'fusionChart', '차트', '퓨전차트'],
  gridDataMap: ['gridDataMap'],
  checkbox: ['checkbox', 'checkboxLabel', '체크박스'],
  radio: ['radio', '라디오'],
  udc: ['udc', 'UDC', 'User Defined Component'],
};

const COMPONENT_NAMES = Object.keys(COMPONENT_DICT);

// 행위/액션 단어 (한국어 + 영어)
const ACTION_PATTERNS = [
  // 한국어 동사
  '복사', '붙여넣기', '잘라내기', '선택', '다중선택', '병합',
  '다운로드', '업로드', '내보내기', '가져오기',
  '저장', '로딩', '갱신', '새로고침', '재로딩', '리로드',
  '동적', '동적생성', '동적변경', '바인딩',
  '검증', '암호화', '복호화', '인증',
  '엑셀', '엑셀다운로드', '엑셀업로드',
  '단축키', '포커스', '스크롤',
  '병합셀', '셀병합', '고정컬럼', '고정행', '푸터', 'footer',
  '정렬', '필터', '검색', '조회',
  '교육', '핫픽스', '패치',
  // 영어
  'copy', 'paste', 'select', 'merge',
  'download', 'upload', 'export', 'import',
  'save', 'load', 'refresh',
  'bind', 'binding', 'dynamic',
  'excel', 'shift', 'ctrl', 'focus', 'scroll',
  'lifecycle', 'onpageload', 'oninit',
];

// 정규식: API명 후보 (camelCase, dot notation, set/get/on 접두)
const API_PATTERNS = [
  /\b([a-z][a-zA-Z]{2,})\(\)/g, // foo()
  /\b([a-zA-Z][a-zA-Z0-9_]*)\.([a-zA-Z][a-zA-Z0-9_]+)/g, // obj.method
  /\b((?:set|get|on|advanced|prevent|use|show|hide|enable|disable|fixed|multiple|exec|open|close)[A-Z][a-zA-Z0-9_]+)/g,
  /\b(WebSquare\.[a-zA-Z]+(?:\.[a-zA-Z]+)*)/g,
  /\$[pc]\.[a-zA-Z]+/g,
  // 일반 camelCase 단어 (소문자로 시작, 대문자 1개 이상 포함, 6글자 이상)
  /\b([a-z][a-z0-9]+[A-Z][a-zA-Z0-9]{2,})/g,
];

// 버전 패턴
const VERSION_PATTERN = /\b(AI|SP[1-5]|WebSquare\s*2|ws[25])\b/gi;

// 무의미 토큰 (제거 대상)
const STOPWORDS = new Set([
  'function', 'var', 'const', 'let', 'return', 'true', 'false', 'null',
  'undefined', 'this', 'new', 'if', 'else', 'for', 'while', 'console',
  '안녕하세요', '문의', '드립니다', '바랍니다', '감사합니다',
]);

/**
 * 질문에서 컴포넌트/API/행위/버전 엔티티 추출
 * @param {string} question
 * @returns {object} { components, apis, actions, version, tokens }
 */
function extractEntities(question) {
  const text = String(question || '');
  const lower = text.toLowerCase();

  const components = [];
  for (const [canonical, aliases] of Object.entries(COMPONENT_DICT)) {
    const matched = aliases.some((alias) => {
      // 영어 alias는 lowercase 비교, 한국어는 원본 비교
      if (/^[a-zA-Z_ ]+$/.test(alias)) {
        return lower.includes(alias.toLowerCase());
      }
      return text.includes(alias);
    });
    if (matched && !components.includes(canonical)) {
      components.push(canonical);
    }
  }

  const actions = [];
  for (const a of ACTION_PATTERNS) {
    if (text.includes(a) && !actions.includes(a)) actions.push(a);
  }

  const apis = new Set();
  for (const re of API_PATTERNS) {
    let m;
    const local = new RegExp(re.source, re.flags);
    while ((m = local.exec(text)) !== null) {
      const token = m[0].replace(/\(\)$/, '');
      if (STOPWORDS.has(token.toLowerCase())) continue;
      if (token.length >= 4 && token.length <= 50) apis.add(token);
    }
  }

  const versionMatches = text.match(VERSION_PATTERN) || [];
  const version = versionMatches.length > 0 ? versionMatches[0].toUpperCase() : null;

  return {
    components,
    apis: [...apis],
    actions,
    version,
  };
}

/**
 * 1차 RAG 결과의 신뢰도 평가
 *
 * 신뢰도 점수(0~1):
 *  - top1Score (40%): 최상위 결과의 final_score
 *  - sourceQuality (25%): 공식 문서(API Guide/Dev Guide/Release/Confluence) 포함률
 *  - keywordMatch (20%): 질문 엔티티가 결과 내용에 매칭되는 비율
 *  - resultDensity (15%): high-quality(>0.6) 결과 수
 *
 * @param {object} ragResult - { cases: [...] } from parseRagResults
 * @param {object} entities - extractEntities 결과
 * @returns {object} { score, breakdown, signals }
 */
function evaluateRagConfidence(ragResult, entities = {}) {
  const cases = ragResult?.cases || [];
  if (cases.length === 0) {
    return {
      score: 0,
      breakdown: { top1Score: 0, sourceQuality: 0, keywordMatch: 0, resultDensity: 0 },
      signals: { reason: 'no_results', shouldRefine: true },
    };
  }

  // 1. top1Score: top-1 match (0~100) → 정규화 (0~1)
  const top1Score = (cases[0].match || 0) / 100;

  // 2. sourceQuality: 공식 문서 포함률 (top 5 기준)
  const officialSources = ['api guide', 'release', 'guide', 'confluence', '개발 가이드', '컴포넌트 가이드'];
  const top5 = cases.slice(0, 5);
  const officialCount = top5.filter((c) => {
    const src = (c.source || '').toLowerCase();
    return officialSources.some((o) => src.includes(o));
  }).length;
  const sourceQuality = officialCount / top5.length;

  // 3. keywordMatch: 추출한 엔티티가 결과 content에 등장하는 비율
  const allEntities = [
    ...(entities.components || []),
    ...(entities.apis || []),
    ...(entities.actions || []),
  ];
  let keywordMatch = 0;
  if (allEntities.length > 0) {
    const combinedContent = top5.map((c) => `${c.title} ${c.content || ''}`).join(' ').toLowerCase();
    const matched = allEntities.filter((e) => combinedContent.includes(String(e).toLowerCase()));
    keywordMatch = matched.length / allEntities.length;
  } else {
    keywordMatch = 0.5; // 엔티티 없으면 중립
  }

  // 4. resultDensity: 고품질 결과 수
  const highQualityCount = cases.filter((c) => (c.match || 0) >= 60).length;
  const resultDensity = Math.min(highQualityCount / 3, 1);

  const score =
    top1Score * 0.40 +
    sourceQuality * 0.25 +
    keywordMatch * 0.20 +
    resultDensity * 0.15;

  // 신호 정리
  const signals = {
    shouldRefine: score < 0.6,
    needsOfficialBoost: sourceQuality < 0.4 && officialCount === 0,
    needsKeywordBoost: keywordMatch < 0.5 && allEntities.length > 0,
    lowDensity: resultDensity < 0.5,
  };

  return {
    score: Number(score.toFixed(3)),
    breakdown: {
      top1Score: Number(top1Score.toFixed(3)),
      sourceQuality: Number(sourceQuality.toFixed(3)),
      keywordMatch: Number(keywordMatch.toFixed(3)),
      resultDensity: Number(resultDensity.toFixed(3)),
    },
    signals,
  };
}

/**
 * 보강 검색 쿼리 후보 생성 (규칙 기반)
 *
 * 전략:
 *  - 엔티티만 추출한 짧고 압축된 쿼리 생성 (벡터 검색 노이즈 감소)
 *  - 원본 질문에 없는 동의어/유사 키워드 확장
 *
 * @param {string} originalQuestion
 * @param {object} entities
 * @param {object} confidence
 * @returns {Array<{query, strategy, sourceFilter?}>}
 */
function buildRefinementCandidates(originalQuestion, entities, confidence) {
  const candidates = [];

  // 전략 1: 컴포넌트 + 행위 압축 쿼리
  if (entities.components.length > 0 || entities.actions.length > 0) {
    const tokens = [
      ...entities.components.slice(0, 3),
      ...entities.actions.slice(0, 4),
    ];
    if (tokens.length >= 2) {
      candidates.push({
        query: tokens.join(' '),
        strategy: 'entity-compact',
      });
    }
  }

  // 전략 2: API 후보가 풍부한 경우 - API명만으로 검색
  if (entities.apis.length >= 2) {
    candidates.push({
      query: entities.apis.slice(0, 5).join(' '),
      strategy: 'api-only',
    });
  }

  // 전략 3: 공식 문서 부족 → API Guide 강제 검색
  if (confidence.signals.needsOfficialBoost) {
    const officialQuery = [
      ...entities.components.slice(0, 2),
      ...entities.apis.slice(0, 3),
      'API',
    ].filter(Boolean).join(' ');
    if (officialQuery.length > 5) {
      candidates.push({
        query: officialQuery,
        strategy: 'official-boost',
        sourceFilter: 'official', // pipeline에서 filterRagCases로 후처리
      });
    }
  }

  return candidates;
}

/**
 * 다단계 검색 결과 병합
 *
 * - 같은 케이스(content 또는 title 기준)는 중복 제거
 * - 첫 검색 결과는 우선 보존 (rank 안정성)
 * - 보강 검색 결과는 새로운 케이스만 추가
 *
 * @param {Array<object>} primary - 1차 cases
 * @param {Array<Array<object>>} secondary - 2차+ cases 묶음
 * @returns {Array<object>} - 병합 cases
 */
function mergeRagCases(primary, secondary) {
  const seen = new Set();
  const result = [];

  const keyOf = (c) => {
    const t = (c.title || '').trim().slice(0, 80);
    const s = (c.source || '').trim();
    return `${s}::${t}`;
  };

  for (const c of primary || []) {
    const k = keyOf(c);
    if (seen.has(k)) continue;
    seen.add(k);
    result.push(c);
  }

  for (const group of secondary || []) {
    for (const c of group || []) {
      const k = keyOf(c);
      if (seen.has(k)) continue;
      seen.add(k);
      result.push({ ...c, fromRefinement: true });
    }
  }

  return result;
}

module.exports = {
  extractEntities,
  evaluateRagConfidence,
  buildRefinementCandidates,
  mergeRagCases,
  // testing exports
  COMPONENT_NAMES,
  ACTION_PATTERNS,
};
