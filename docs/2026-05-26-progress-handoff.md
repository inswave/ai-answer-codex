# 2026-05-26 진행 상황 인수인계 (내일 이어서)

## 오늘 완료한 것

### 1. 코드 커밋 완료 (`3069adc`)
34 files, +3,434 lines. 모든 5/20~5/26 변경분 포함:
- B 다단계 RAG 검색 (queryRefinement.js, pipeline.js)
- MCP static provider + 14개 alias + buildQueries fallback + ### 헤더 지원
- OCR/promptMemory/apiVerifier/answerPolicy 등 안정화

### 2. 서버 배포 완료 (PID 11598)
- 서버: `/var/www/html/ser-pr5/ai-answer-codex`
- config.json에 `mcp.enabled=true, provider=static` + `refinement` 추가됨
- RAG 데이터(chroma 422MB) 5/21 시점으로 교체

### 3. MCP Phase 2.5 수집 진행 중 (22개 컴포넌트)
`data/processed/mcp_specs/` 현재 상태:
- 완전판 14개: $p, autoComplete, dataMap, editor, fusionchart, group, inputCalendar, multiupload, selectbox, tabControl, treeview, wframe, windowContainer + Submission
- 부분판 3개: gridView, dataList, textbox
- 서브컴포넌트: WebSquare/{util, layer}, gridView/column (169KB), dataList/column (99KB)

**디스크**: 975KB, 57개 .md 파일

## ⚠️ 내일 이어서 할 것

### A. Tier 3 나머지 30+ 컴포넌트 수집 (가장 중요)

Agent rate limit이 풀리면 다음 명령으로 재실행:

```
프롬프트 핵심:
- 압축 금지, 원본 그대로
- 디스크 자동 캐시 → Bash cp로 옮기기
- 인라인 응답 → Write tool로 저장
- 슬래시 컴포넌트는 슬래시 그대로 (WebSquare/net, gridView/header 등)
```

미수집 대상:
```
입력: textbox(완전판), textarea, input, checkbox, radio, multiselect, trigger, searchbox, secret, floatingLayer
컨테이너: nameLayer, gridLayout, scrollView
GridView 서브: header, footer, row, filterColumn, subTotal, gBody
DataList/Map 서브: dataList/{columnInfo, row, data}, dataMap/{key, data, keyInfo}
캘린더: scheduleCalendar, datePicker, calendar
차트: mapchart, fwGanttChart, fwBulletChart, fwFunnelChart, fwGaugeChart, fwPyramidChart, fwRealtimeChart, fwSparkChart
유틸: $p/data, WebSquare/{net, json, date, xml, cookie, logger, style}
```

### B. 운영 안정성 모니터링

서버에서:
```bash
tail -f /var/www/html/ser-pr5/ai-answer-codex/server.out.log
```

확인 포인트:
- `[Pipeline] MCP context: N items` 출현 (MCP 작동)
- `[Pipeline] refining with N queries` 출현 (B 다단계)
- 에러 없이 답변 완료
- 응답 시간 (refinement 있는 경우 5-10초 추가)

### C. Tier 3 완성 후 추가 배포

```bash
# 1. 새 tar 생성
tar -czf deploy_mcp_phase3_2026-05-XX.tar.gz \
  src/generator/mcpContext.js \
  data/processed/mcp_specs/

# 2. 서버에 업로드
scp deploy_mcp_phase3_*.tar.gz server:/home/ubuntu/

# 3. 서버에서 풀기 (재기동 필요)
cd /var/www/html/ser-pr5/ai-answer-codex
tar -xzf /home/ubuntu/deploy_mcp_phase3_*.tar.gz
# 백업: cp src/generator/mcpContext.js /var/www/html/ser-pr5/ai-answer-backup-2026-05-26/

# 4. 재기동
kill -TERM <현재 PID>
nohup node src/api/server.js > server.out.log 2> server.err.log &
```

## 현재 배포 패키지 보유

```
deploy_mcp_phase2.5_2026-05-26.tar.gz  (188K) ★ 최신 — mcpContext.js + 22 컴포넌트
deploy_2026-05-26.tar.gz                (116K)  서버 적용 완료
data_deploy_2026-05-26.tar.gz           (256M)  서버 적용 완료
deploy_mcp_phase2_2026-05-26.tar.gz     (120K)  중간본 (Phase 2.5에 포함, 삭제 가능)
deploy_mcp_specs_2026-05-26.tar.gz      (94K)   초기본 (폐기 가능)
```

## 새 세션 시작할 때 빠른 캐치업

```bash
# 1. 진행 노트 읽기
cat docs/2026-05-26-progress-handoff.md
cat docs/2026-05-26-deploy-log.md

# 2. 현재 상태 확인
git log --oneline -3
find data/processed/mcp_specs/ -name "*.md" | wc -l
du -sh data/processed/mcp_specs/

# 3. 매칭률 검증 (현재 약 83-93%)
node -e "
process.env.ENABLE_MCP_CONTEXT='1';
process.env.MCP_CONTEXT_PROVIDER='static';
const { buildMcpContext } = require('./src/generator/mcpContext');
(async () => {
  const r = await buildMcpContext('gridView advancedExcelDownload xlsx', []);
  console.log('items:', r.items.length, 'ctx:', r.context.length);
})();
"
```

## 알려진 한계

| 케이스 | MCP 매칭 | 비고 |
|---|---|---|
| `multipleExcelUpload` | ❌ | MCP에 데이터 없음 (RAG 의존) |
| `openMenu` | ❌ | MCP에 데이터 없음 (실제 API명은 openPopup) |
| `showProcessMessage` | ✅ ($p) | alias 정확히 매핑됨 |
| 그 외 95%+ | ✅ | 정상 |
