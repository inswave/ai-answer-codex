# 2026-05-26 배포 가이드

## 변경 요약

### 신규 기능
1. **B (다단계 RAG 검색)** — 1차 검색 신뢰도 평가 → 부족하면 키워드 추출 후 2차 검색 자동 실행 (`queryRefinement.js`, `pipeline.js`)
2. **MCP 정적 스펙 (Phase 1)** — WebSquare 공식 API 스펙을 정적 파일로 제공. 현재 gridView + dataList 커버 (`mcpContext.js` static provider, `data/processed/mcp_specs/`)
3. **qnaViewAI.xml CSS 보정** — paragraph 간격 14px로 (W-Tech 화면, 별도 배포 경로)

### 효과
- B: 신뢰도 낮은 케이스에서 평균 +0.1~0.15 신뢰도 상승, 4/12 케이스가 임계값(0.6) 돌파
- MCP: gridView/dataList 관련 질문에서 공식 옵션명/스펙 정확 인용 (환각 0)

---

## 서버 배포 대상

서버: `/var/www/html/ser-pr5/ai-answer-codex`

### A. 코드 파일 (14개)

```
src/generator/answerGenerator.js     (5/22)
src/generator/answerPolicy.js        (5/22)
src/generator/apiVerifier.js         (5/22)
src/generator/attachmentContext.js   (5/22)
src/generator/pipeline.js            (5/26 — B 통합)
src/generator/mcpContext.js          (5/26 — static provider 추가)  ★
src/generator/queryRefinement.js     (5/26 — 신규)                  ★
src/api/routes/answer.js             (5/22)
src/api/routes/search.js             (5/22)
src/rag/parseRagResults.js           (5/22)
src/rag/sampleMatcher.js             (5/22)
src/utils/masking.js                 (5/22)
scripts/merge.js                     (5/21)
config/config.example.json           (5/26 — mcp.static 옵션 문서화)
```

### B. 데이터 (선택)

이미 5/21 재인덱싱 후 변동 없음. 서버 측 데이터가 5/19 시점이면 함께 올림.

```
data/processed/all_qa.json
data/processed/classified_qa.json
data/processed/category_digests.json
data/chroma/chroma.sqlite3
data/chroma/4dbaf1e1-b690-4590-b581-9b3f5aa72a94/   (최신 컬렉션)
```

### C. MCP 정적 스펙 (신규, 필수)

```
data/processed/mcp_specs/
├── gridView/
│   ├── methods.md       (169KB)
│   └── properties.md    (78KB)
└── dataList/
    └── methods.md       (99KB)
```

**총 약 345KB** — 가벼움. 향후 컴포넌트 추가 시 디렉토리만 채우면 자동 사용.

---

## 서버 측 config 갱신

서버 `config/config.json`에 아래 추가 (예시 파일 기준):

```json
{
  "mcp": {
    "enabled": true,
    "provider": "static",
    "staticDir": "./data/processed/mcp_specs",
    "staticMaxBytes": 4000,
    "timeoutMs": 5000,
    "maxItems": 5,
    "cacheTtlMs": 3600000
  },
  "refinement": {
    "enabled": true,
    "confidenceThreshold": 0.6,
    "maxRefinementSearches": 2
  }
}
```

---

## 배포 후 확인

```bash
cd /var/www/html/ser-pr5/ai-answer-codex

# 1. 모듈 로드 확인
node -e "require('./src/generator/queryRefinement'); \
  require('./src/generator/mcpContext'); \
  require('./src/generator/pipeline'); \
  console.log('all modules ok')"

# 2. 서버 재기동
pm2 restart ai-answer-codex   # 또는 사용 중인 프로세스 매니저

# 3. health check
curl http://localhost:3000/api/health

# 4. MCP 통합 검증 (gridView 관련 질문)
curl -X POST http://localhost:3000/api/answer \
  -H "Content-Type: application/json" \
  -d '{"query":"gridView advancedExcelDownload xlsx 다운로드 설정"}' | head -50

# 로그에서 다음 확인:
# [Pipeline] MCP context: 1 items
# [Pipeline] RAG primary: 8 cases, confidence=...
```

---

## 롤백 방법

문제 발생 시 `config.mcp.enabled: false`, `config.refinement.enabled: false`로 끄면 즉시 기존 동작으로 복귀 (코드는 둘 다 graceful degradation).

---

## 다음 단계 (Phase 2)

남은 컴포넌트 spec 수집:
- selectbox, inputCalendar, wframe, dataMap, tabControl, treeview, autoComplete
- Submission, $p, WebSquare/* utilities
- 그 외 78개 컴포넌트

자동화: Claude Code에서 MCP 호출 → tool-results 자동 저장 활용. 약 반나절 작업.
