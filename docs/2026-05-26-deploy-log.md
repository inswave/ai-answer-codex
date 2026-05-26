# 2026-05-26 배포 작업 기록

## 배포 완료 (서버 PID 11598)

서버: `/var/www/html/ser-pr5/ai-answer-codex`
- 이전 PID 17840 (5/20 가동, 5/20 코드 기준)
- 신규 PID 11598 (5/26 15:33 가동)
- 다운타임: 약 1분 (chroma 풀기 시간)

## 적용 변경

### 1. B — 다단계 RAG 검색 (신규 기능)
- `src/generator/queryRefinement.js` (신규, 10.8KB)
  - `extractEntities()` — 한국어 별칭 포함 컴포넌트/API/행위 추출
  - `evaluateRagConfidence()` — top1Score × 0.4 + sourceQuality × 0.25 + keywordMatch × 0.2 + resultDensity × 0.15
  - `buildRefinementCandidates()` — entity-compact, api-only, official-boost 전략
  - `mergeRagCases()` — primary 우선, secondary 중복 제거
- `src/generator/pipeline.js` — `_searchRAGMultiStep()` 추가, process/processFollowUp에서 호출
- config: `refinement.enabled=true`, `confidenceThreshold=0.6`, `maxRefinementSearches=2`

**효과 (로컬 평가)**: 신뢰도 낮은 케이스 12건 중 8건에서 의미 있는 개선, 4건이 임계값 0.6 돌파.

### 2. MCP Static Provider (Phase 1)
- `src/generator/mcpContext.js` — `queryByStatic()` 추가
- 데이터: `data/processed/mcp_specs/{component}/{section}.md`
  - gridView/methods.md (169KB), properties.md (78KB)
  - dataList/methods.md (99KB)
- config: `mcp.enabled=true`, `mcp.provider="static"`, `mcp.staticDir="./data/processed/mcp_specs"`

**효과**: gridView/dataList 관련 질문에서 공식 옵션명 정확 인용. 환각 0건.

### 3. 5/21 안정화 변경 (이전 누적분)
- Gmail 본문 정리 보강 (`scripts/merge.js`)
- Follow-up 빈 답변 처리 (`src/api/routes/answer.js`)
- parseRagResults 공식 도메인 마스킹 제외 (`src/rag/parseRagResults.js`)
- Codex 프롬프트 신설 buildCodexSupportPrompt (`src/generator/answerGenerator.js`)

### 4. 5/22 답변 품질 작업
- answerGenerator/answerPolicy/apiVerifier/attachmentContext 갱신
- sampleMatcher.js 신규
- masking.js 패턴 보강

### 5. RAG 데이터 재인덱싱 (5/21 결과 배포)
- chroma collection: c4a80895 (5/19) → 4dbaf1e1 (5/21 reindex)
- 총 데이터 15,810건
- 컬렉션 폴더 정리됨 (876MB → 422MB)

### 6. W-Tech 화면 (별도 경로)
- `C:\WebSquare_Studio\sp5_x64\websquare_25.0916\workspace\wTech\src\main\webapp\ui\qna\qnaViewAI.xml`
- `.ai-answer-content p` margin 8px → `0 0 14px 0` (paragraph 간격 시각화)
- W-Tech 빌드/패킹 후 반영 필요

## 배포 절차 기록

1. 백업: `/var/www/html/ser-pr5/ai-answer-backup-2026-05-26/` (396K)
2. 데이터 백업: `data/chroma.bak.20260526/` (876M)
3. 코드 풀기: `tar -xzf /home/ubuntu/deploy_2026-05-26.tar.gz` (116KB)
4. 데이터 풀기: `tar -xzf /home/ubuntu/data_deploy_2026-05-26.tar.gz` (256MB)
5. config 머지: mcp + refinement 블록 추가 (node -e merge 스크립트)
6. 재기동: `kill -TERM 17840` → `nohup node src/api/server.js > server.out.log 2>&1 &`

## 적용 후 답변 흐름

```
W-Tech 고객 문의 → /api/answer (또는 /follow-up)
  ↓
1. 분류 + RAG 1차 검색 (8건)
  ↓
2. 신뢰도 평가 (B 다단계)
  ├ ≥0.6: 그대로 진행
  └ <0.6: 키워드 추출 → 보강 RAG 검색 (최대 2회) → 병합
  ↓
3. MCP 정적 스펙 조회 (현재: gridView/dataList)
  ↓
4. Codex 답변 생성 (RAG + MCP + 첨부 + 질문 컴포넌트 컨텍스트)
  ↓
5. API 검증 (RAG $contains + 로컬 HTML/XML)
  ↓ (미확인 API 있으면 재생성, 최대 3회)
6. 마스킹 → 저장 → 큐 등록 → 응답
```

## 다음 단계 (예정)

- **MCP Phase 2 (진행 중)**: Tier 1 나머지 8개 컴포넌트 spec 수집 후 배포 (data/processed/mcp_specs/ 폴더에 추가만 하면 자동 사용됨)
- **검수된 답변 자동 누적 루프**: 운영 절차 + 주간 reindex 자동화
- **B refinement gap 보강**: 11057 "W2X 파일" 같은 에러 키워드 패턴 추가

## 로컬 정리 대상

- `deploy_2026-05-26.tar.gz`, `data_deploy_2026-05-26.tar.gz` (필요 없으면 삭제 가능)
- `config/config.json.bak` (백업 보관)
- 로컬 chroma 옛 collection 8개 (사용 안 함, 디스크 정리 가능)
