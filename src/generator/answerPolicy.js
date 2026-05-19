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
      '정확한 확인을 위해 재현 샘플, 엔진 상세 버전, 적용 화면 구조 등의 추가 정보가 필요할 수 있습니다.',
      '추가 정보를 입력하여 AI 추가답변을 요청하거나, 엔지니어 추가 답변을 요청해 주세요.',
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
    reason: '파일 전달, 라이선스, 설치 파일 또는 권한 확인 성격의 문의',
    requiredInfo: ['담당자 확인이 필요한 요청 사항'],
    pattern: /라이선스|라이센스|license|ellicense|설치\s*파일|websquare2|웹스퀘어\s*2|websquare\s*2|버전\s*내리|플러그인\s*전달|키\s*발급|계약|권한\s*확인|위험\s*첨부/i,
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
      '- 원인이나 패치 적용 여부를 단정하지 마십시오.',
      '- 확인 가능한 범위의 점검 항목만 안내하고 엔지니어 검토가 필요함을 자연스럽게 포함하십시오.',
    ].join('\n');
  }

  if (mode === MODES.NEEDS_CONTEXT) {
    return [
      '답변 정책: needs_context',
      '- 첨부 샘플, 재현 조건, 엔진 빌드 버전 또는 화면 구조 확인이 필요한 유형입니다.',
      '- 가능한 원인은 보수적으로 표현하고, 재현 확인 전 엔진 결함이나 패치 필요를 단정하지 마십시오.',
      '- 유사 사례 기준의 우선 확인 사항과 추가로 필요한 정보를 함께 안내하십시오.',
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
