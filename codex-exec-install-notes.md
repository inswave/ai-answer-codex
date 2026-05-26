# 2026-05-19 AI Answer 작업 메모

## 프로젝트 위치

- 로컬: `C:\Users\user\Desktop\ai-answer-remote`
- 개발서버 Node/RAG: `/var/www/html/ser-pr5/ai-answer-codex`
- 개발서버 W-Tech: `/var/www/html/ser-pr5/wTech`

## Node API 서버

- 실행 파일: `src/api/server.js`
- 포트: `3000`
- 상태 확인:

```bash
cd /var/www/html/ser-pr5/ai-answer-codex
ps -ef | grep 'src/api/server.js' | grep -v grep
curl -s http://localhost:3000/api/health
```

- 재시작:

```bash
cd /var/www/html/ser-pr5/ai-answer-codex
kill <PID>
nohup node src/api/server.js > server.out.log 2> server.err.log &
tail -n 20 server.out.log
tail -n 20 server.err.log
```

## 주요 수정 파일

### Node/RAG

- `src/api/routes/answer.js`
  - 참고 자료 노출 개수 3개 제한
  - 샘플 파일 매칭 결과를 `sampleFiles`로 응답
- `src/api/routes/search.js`
  - 검색 응답에도 샘플 파일 매칭 반영
- `src/rag/sampleMatcher.js`
  - `data/raw/dev-guide-sample` 아래 XML 샘플 매칭
  - `GridView`, `_p/Submission` 같은 폴더 구조 대응
- `src/collectors/index.js`
  - 선택된 collector만 lazy require
  - `--source gmail,confluence` 실행 시 WTech/Puppeteer/API Guide 의존성 미로딩
- `config/config.json`
  - Gmail, WTech, WTech FAQ, Confluence 설정 서버에 통교체
  - 민감정보 포함. 채팅/로그에 노출 금지

### W-Tech

- `src/main/java/com/inswave/wtech/support/service/AiAnswerGenerator.java`
  - Node `/api/answer` 응답의 `sampleFiles`를 `ATTACH_FILES`로 저장
  - 로그에 `attachmentsJsonLen` 출력
- `src/main/webapp/ui/qna/qnaViewAI.xml`
  - 참고 자료 마지막 항목 하단 padding 조정

### 서버 배포 위치

- `qnaViewAI.js`
  - `/var/www/html/ser-pr5/wTech/webapps/wTech/_wpack_/ui/qna/qnaViewAI.js`
- `AiAnswerGenerator.class`
  - `/var/www/html/ser-pr5/wTech/webapps/wTech/WEB-INF/classes/com/inswave/wtech/support/service/AiAnswerGenerator.class`

## 샘플 파일 데이터

- 서버 위치:

```bash
/var/www/html/ser-pr5/ai-answer-codex/data/raw/dev-guide-sample
```

- 중첩 폴더가 생기면 정리:

```bash
cd /var/www/html/ser-pr5/ai-answer-codex/data/raw/dev-guide-sample
mv dev-guide-sample/* .
rmdir dev-guide-sample
```

## 답변 테스트

```bash
cd /var/www/html/ser-pr5/ai-answer-codex
curl -s http://localhost:3000/api/answer \
  -H 'Content-Type: application/json' \
  -d '{"query":"gridView 셀 병합 mergeCells 사용법 샘플도 있으면 좋겠어요","topK":8}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const r=JSON.parse(s);console.log('confidence:',r.confidence);console.log('sources:',(r.sources||[]).length);console.log('sampleFiles:',(r.sampleFiles||[]).length);console.log((r.sampleFiles||[]).map(f=>f.filename||f.name).join('\n'));})"
```

정상 기대:

- `sources: 3`
- `sampleFiles: 5`
- `mergeCells_*_GridView.xml` 계열 샘플 출력

## 크롤링 및 인덱싱

현재 서버에서 실제 사용 가능한 주 수집원:

- `gmail`
- `confluence`

제외:

- `wtech`, `wtechFaq`: Puppeteer/Chromium 환경 필요
- `apiGuide`: 원본 HTML 폴더 없음

수동 실행:

```bash
cd /var/www/html/ser-pr5/ai-answer-codex
node scripts/collect.js --source gmail,confluence --since YYYY-MM-DD
npm run classify
npm run index
```

전체 재인덱싱이 필요할 때만:

```bash
npm run index:reset
```

## 주간 자동 실행

스크립트:

```bash
/var/www/html/ser-pr5/ai-answer-codex/scripts/weekly_pipeline.sh
```

내용 흐름:

```text
최근 7일 Gmail + Confluence 수집
-> npm run classify
-> npm run index
```

cron 등록:

```cron
0 3 * * 1 /var/www/html/ser-pr5/ai-answer-codex/scripts/weekly_pipeline.sh
```

확인:

```bash
crontab -l
tail -f /var/www/html/ser-pr5/ai-answer-codex/logs/weekly_pipeline_$(date +%F).log
```

## 로그 및 용량 확인

```bash
cd /var/www/html/ser-pr5/ai-answer-codex
tail -n 50 server.out.log
tail -n 50 server.err.log
df -h
du -sh data data/raw data/chroma logs node_modules
du -sh data/raw/* | sort -h
```

## 보안 메모

채팅에 OAuth refresh token, client secret, Confluence API token, WTech 비밀번호가 노출된 적 있음.
운영 적용 전 아래 항목은 재발급/교체 필요:

- Gmail OAuth refresh token
- Gmail OAuth client secret
- Confluence API token
- WTech 계정 비밀번호
