# 2026-06-01 참고자료 dedup + 서비스 요청 short-circuit (A+B)

미커밋 상태(5/26 커밋 이후). 운영 반영 직전 일괄 커밋 예정. 백업: `*.bak_20260601`.

## 1. 참고자료(sources) 중복 제거 — `src/api/routes/answer.js`

`/api/answer` 응답의 `sources`는 `MAX_VISIBLE_SOURCES=3`으로 잘렸는데(답변 생성 컨텍스트는 topK=8, 노출만 3), 같은 출처 타입이 중복 노출되는 문제가 있었음.

**규칙 (`dedupVisibleSources`, slice 전 적용):**
- 링크(url) 있는 항목 → **항상 노출**(중복 제거 제외)
- 링크 없는 항목 → **타입(board/email/wiki 등)당 1개만** (유사도 상위가 앞이라 대표 1건 유지)
- 그 다음 **최대 3개**로 cap

> 참고: 현재 wtech(board)/gmail(email)/confluence(wiki)는 `c.url`(=chroma metadata.url, item.url 유래)이 비어 "링크 없음" → dedup 대상. api-guide/release-note/dev-guide는 `getDocsUrl` 폴백으로 정적 링크 있음 → 항상 노출. confluence url은 파이프라인 지원은 되나(masking 화이트리스트에 atlassian.net 있음) 데이터(item.url) 미수록이라 현재 빈 값.

검증: 실제 함수 소스 추출 실행 — wtech3→1, gmail2→1, 섞임→각1, 링크2개→둘다, 링크4개→cap3 전부 통과.

## 2. 서비스 요청 short-circuit (A+B) — 라이선스/데모/엔진·플러그인 파일 등

기술 문의가 아닌 **서비스 요청**(라이선스 발급, 데모/평가판, 엔진·플러그인 파일 제공, 계약·권한 확인)은 RAG/Claude 답변이 불필요. 기존엔 `answerPolicy`가 BLOCKED로 분류만 하고 **파이프라인은 RAG+Claude+검증/재생성을 그대로 다 돌렸음**(early-return 없음).

### A. pipeline.js short-circuit (`process`)
- 분류 직후·RAG 직전에 `evaluateAnswerPolicy({question, cases:[]})`(질문 기준)로 선판정.
- `answerMode === BLOCKED`이면 **RAG/Claude 스킵** + **참고자료(sources) 빈 배열** + 담당자 안내 템플릿만 반환. (`_saveAnswer`/큐도 스킵)
- 안내 템플릿: 일반 답변과 동일하게 `config.answer.template`(인사말/맺음말)을 코드로 치환, 본문은 한 줄.
  ```
  안녕하세요.
  인스웨이브 기술지원팀 AI 답변입니다.

  문의해 주신 내용은 담당 엔지니어 확인이 필요한 사안입니다.
  엔지니어 추가 답변 요청을 부탁드립니다.

  감사합니다.
  ```
  (추가 정보 요청 불릿은 제거 — 요청 종류·제품/버전 등은 어차피 글 본문에 작성되므로 중복. 처리는 wTech "엔지니어 추가 답변 요청" 기능으로 연결.)
- 반환 객체는 정상 `process` 반환 shape와 동일하게 맞춰 라우트 호환 유지.
- ⚠ `processFollowUp`(후속질문)에는 미적용 — 필요 시 추후 동일 처리.

### B. answerPolicy.js BLOCKED 패턴 보강
- 추가: `데모\s*(?:라이선스|버전|판|신청|요청|키|계정|환경)`, `평가판|체험판`, `엔진\s*(?:파일|다운로드|받|제공|전달|요청)`, `플러그인\s*(?:전달|다운로드|파일|받|제공|요청|주세요)`.
- **엔진/플러그인은 서비스 동사와 인접할 때만** 매칭 — "엔진 버전 확인", "플러그인 설치 방법" 같은 기술문의 오탐 방지(보수적 선택).
- 알려진 한계: "엔진 최신 빌드 제공"처럼 엔진·동사 비인접 표현은 미매칭(auto_answer 또는 "최신 엔진"이면 HUMAN_REVIEW). 오탐 0 우선으로 의도적 보수. 실제 사례 모이면 조정.

검증: `evaluateAnswerPolicy` 실제 require — 데모 라이선스/엔진 파일/플러그인 다운로드/평가판/라이선스 키 → blocked. gridView·엔진버전확인·플러그인설치방법·데모화면깨짐 → auto_answer(오탐 0).

## 변경 파일 요약 (미커밋)
- `src/api/routes/answer.js` — dedupVisibleSources 추가
- `src/generator/pipeline.js` — MODES import + BLOCKED short-circuit
- `src/generator/answerPolicy.js` — BLOCKED 패턴 보강
