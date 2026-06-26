const { maskSensitiveInfo } = require('../utils/masking');

const MODES = {
  AUTO_ANSWER: 'auto_answer',
  NEEDS_CONTEXT: 'needs_context',
  HUMAN_REVIEW: 'human_review',
  BLOCKED: 'blocked',
};

const MODE_META = {
  [MODES.AUTO_ANSWER]: {
    riskLevel: 'low',
    notice: [
      '---',
      '위 답변이 문의 내용과 일치하면 답변을 채택해 주세요.',
      '추가 확인이 필요하면 AI 추가답변 또는 엔지니어 추가 답변을 요청하실 수 있습니다.',
    ].join('\n'),
  },
  [MODES.NEEDS_CONTEXT]: {
    riskLevel: 'medium',
    notice: [
      '---',
      '위 답변은 현재 참고자료와 유사 사례 기준의 우선 확인/적용 방향입니다.',
      '엔진 상세 버전, 재현 샘플, 적용 화면 구조에 따라 세부 조정이 필요하면 추가 정보를 입력해 주세요.',
    ].join('\n'),
  },
  [MODES.HUMAN_REVIEW]: {
    riskLevel: 'high',
    notice: [
      '---',
      '이 문의는 엔진 버전, 패치, 프로젝트 설정 또는 재현 확인이 필요할 수 있어 엔지니어 추가 답변을 권장드립니다.',
    ].join('\n'),
  },
  [MODES.BLOCKED]: {
    riskLevel: 'high',
    notice: [
      '---',
      '이 요청은 파일 전달, 라이선스, 계약 또는 권한 확인이 필요한 사안일 수 있어 엔지니어 추가 답변을 요청해 주세요.',
    ].join('\n'),
  },
};

const RULES = [
  {
    mode: MODES.BLOCKED,
    reason: '라이선스·데모/평가판·엔진/플러그인 파일 제공·설치 파일·계약/권한 확인 성격의 서비스 요청',
    requiredInfo: ['담당자 확인이 필요한 요청 사항'],
    // [2026-06-01] 데모/평가판, 엔진·플러그인 파일 제공 요청 패턴 보강 (서비스 요청 → AI 답변 대상 아님)
    //   엔진/플러그인은 서비스 동사(파일/다운로드/제공/전달/요청 등)와 함께일 때만 매칭 — "엔진 버전 확인", "플러그인 설치 방법" 같은 기술문의 오탐 방지
    // [2026-06-26] 라이선스/라이센스/license 도 동일하게 서비스 동사 인접 시에만 매칭하도록 게이팅.
    //   "라이선스로 인한 오류", "라이선스 관련된 내용" 처럼 라이선스를 '원인/설명'으로 언급한 기술문의가
    //   단독 키워드 매칭으로 BLOCKED 오탐나던 문제 수정 (실측 사례: gcm/websquare is not defined 오류 문의).
    //   알려진 한계: "라이선스 관련된 내용"은 통과, "라이선스 관련 문의"는 차단 — 동사 비인접 서비스요청은 미매칭(보수적).
    pattern: /(?:라이선스|라이센스|license)\s*(?:발급|문의|신청|요청|구매|구입|연장|갱신|등록|제공|전달|키|계약|관련\s*(?:문의|요청))|ellicense|설치\s*파일|websquare2|웹스퀘어\s*2|websquare\s*2|버전\s*내리|키\s*발급|계약|권한\s*확인|위험\s*첨부|데모\s*(?:라이선스|라이센스|버전|판|신청|요청|키|계정|환경)|평가판|체험판|엔진\s*(?:파일|다운로드|받|제공|전달|요청)|플러그인\s*(?:전달|다운로드|파일|받|제공|요청|주세요)/i,
  },
  {
    mode: MODES.HUMAN_REVIEW,
    reason: '패치, 핫픽스, 연구소 검토 또는 유선 처리 가능성이 있는 문의',
    requiredInfo: ['정확한 엔진 빌드 버전', '적용 WAS/서버 환경', '재현 샘플 또는 설정 파일'],
    pattern: /핫픽스|hotfix|패치|patch|jar\s*업그레이드|jakarta|javax|연구소|유선|module\s*설정|initScript|공통\s*js|접근성|tabindex|useStartEndDiv|엔진\s*업그레이드|최신\s*엔진/i,
  },
  {
    mode: MODES.NEEDS_CONTEXT,
    reason: '첨부 샘플, 재현 조건, 버전 또는 화면 구조 확인이 필요한 문의',
    requiredInfo: ['재현 샘플 파일', '정확한 엔진 빌드 버전', '재현 순서 또는 화면 구조'],
    pattern: /첨부파일을\s*실행|샘플\s*파일|재현\s*(?:확인|필요|요청)|오류|에러|이상\s*동작|동작\s*오류|안\s*됩니다|안됩니다|안\s*되는|안먹힙니다|적용\s*안|깨짐|스크롤|특정\s*(?:브라우저|환경|버전)|PNG\s*이미지\s*첨부|이미지\s*첨부|화면\s*캡처/i,
  },
];

function buildPolicyText(question, cases = []) {
  const caseText = Array.isArray(cases)
    ? cases.slice(0, 5).map((item) => [
      item.title,
      item.source,
      item.content,
    ].filter(Boolean).join('\n')).join('\n\n')
    : '';

  return maskSensitiveInfo([question, caseText].filter(Boolean).join('\n\n'));
}

function evaluateAnswerPolicy({ question, cases = [] } = {}) {
  const text = buildPolicyText(question || '', cases);
  const matchedRule = RULES.find((rule) => rule.pattern.test(text));
  const mode = matchedRule ? matchedRule.mode : MODES.AUTO_ANSWER;
  const meta = MODE_META[mode];

  return {
    answerMode: mode,
    riskLevel: meta.riskLevel,
    needsHumanReview: mode === MODES.HUMAN_REVIEW || mode === MODES.BLOCKED,
    reviewReasons: matchedRule ? [matchedRule.reason] : [],
    requiredInfo: matchedRule ? matchedRule.requiredInfo : [],
  };
}

function getPolicyNotice(policy) {
  return MODE_META[policy?.answerMode]?.notice || MODE_META[MODES.AUTO_ANSWER].notice;
}

function appendPolicyNotice(answer, policy) {
  const trimmed = String(answer || '').trim();
  const notice = getPolicyNotice(policy);
  if (!trimmed) return notice;
  if (trimmed.includes(notice)) return trimmed;
  return `${trimmed}\n\n${notice}`;
}

function getPromptPolicyInstructions(policy) {
  const mode = policy?.answerMode || MODES.AUTO_ANSWER;

  if (mode === MODES.BLOCKED) {
    return [
      '답변 정책: blocked',
      '- 파일 전달, 라이선스, 계약, 권한 확인 또는 설치 파일 제공이 필요한 요청일 수 있습니다.',
      '- 기술 해결책을 임의로 만들지 말고 담당자 확인이 필요한 사안으로 안내하십시오.',
      '- 고객에게 필요한 추가 정보가 있으면 짧게 요청하십시오.',
    ].join('\n');
  }

  if (mode === MODES.HUMAN_REVIEW) {
    return [
      '답변 정책: human_review',
      '- 패치, 핫픽스, 연구소 검토, 유선 처리, 프로젝트 설정 확인이 필요한 유형일 수 있습니다.',
      '- 원인이나 패치 적용 여부는 단정하지 않되, 확인 가능한 사용 패턴, 점검 항목, 우회 방법은 먼저 안내하십시오.',
      '- 답변을 보류하지 말고 고객이 바로 확인할 수 있는 조치와 엔지니어 검토가 필요한 지점을 분리하십시오.',
    ].join('\n');
  }

  if (mode === MODES.NEEDS_CONTEXT) {
    return [
      '답변 정책: needs_context',
      '- 첨부 샘플, 재현 조건, 엔진 빌드 버전 또는 화면 구조 확인이 필요한 유형입니다.',
      '- 필요한 정보가 일부 부족해도 답변을 보류하지 말고, 참고자료에서 확인되는 우선 원인, 확인 방법, 조치, 예제를 먼저 안내하십시오.',
      '- 엔진 결함, 패치 필요, 특정 빌드 수정 여부만 단정하지 마십시오.',
      '- 답변 시작을 "단정하기 어렵습니다", "확정할 수 없습니다"로 하지 말고, 확인 가능한 결론부터 제시하십시오.',
      '- 예제 요청이 있으면 검증된 API와 사용자 정의 함수/변수임을 구분해 최소 예제를 제공하십시오.',
    ].join('\n');
  }

  return [
    '답변 정책: auto_answer',
    '- API, 속성, 옵션, 사용법이 명확한 유형입니다.',
    '- 참고자료에서 확인되는 범위 안에서 간결하고 구체적으로 답변하십시오.',
  ].join('\n');
}

module.exports = {
  MODES,
  evaluateAnswerPolicy,
  appendPolicyNotice,
  getPromptPolicyInstructions,
};
