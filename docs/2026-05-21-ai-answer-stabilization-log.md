# 2026-05-21 AI Answer Stabilization Log

## 작업 요약

오늘 작업은 Gmail 검색 품질 안정화, 추가질문 생성 멈춤 문제 수정, 참고자료 링크 표시, Codex 답변 프롬프트 개선, RAG 인덱스 재생성을 중심으로 진행했다.

## 주요 변경 사항

### 1. Gmail 데이터 정리 보정

- `scripts/merge.js`에서 Gmail 본문 정리 로직을 보강했다.
- 메일 인용부, 전달/회신 헤더, 서명, 빈 인사말성 라인을 제거하도록 처리했다.
- 제목이 `문의`, `확인 요청`처럼 약한 경우 본문 핵심 일부를 질문에 함께 반영하도록 했다.
- raw 데이터는 서버에 올리지 않고, 외부 raw 경로를 직접 읽을 수 있도록 `--raw-dir` 옵션과 `TECHASSISTANT_RAW_DIR` 환경변수를 지원하도록 변경했다.

예시:

```powershell
node scripts\merge.js --raw-dir "C:\Users\user\Desktop\TechAssistant\data\raw"
```

### 2. 추가질문 생성 멈춤 수정

- `src/api/routes/answer.js`에서 `/api/answer/follow-up` 요청 시 `previousAnswer`가 비어 있어도 처리되도록 수정했다.
- 기존에는 최초 AI 답변이 비어 있는 상태에서 추가질문을 요청하면 400 응답이 발생하고, W-Tech 화면에는 `AI 재답변 진행 중` 상태가 남을 수 있었다.

### 3. 참고자료 sources 개선

- `src/rag/parseRagResults.js`에서 API Guide, 개발가이드, 릴리즈 노트의 대표 URL을 보정하도록 했다.
- `docs.inswave.com`, `docs1.inswave.com`, `inswave01.atlassian.net` URL은 sources에서 마스킹하지 않고 유지하도록 했다.
- W-Tech QNA/FAQ의 실제 게시글 제목은 고객사/프로젝트명이 섞일 수 있어 sources 노출 시 다음처럼 고정했다.

```text
W-Tech QNA -> W-Tech
W-Tech FAQ -> W-Tech FAQ
```

### 4. W-Tech 참고자료 UI 개선

- `qnaViewAI.xml`에서 sources의 `url` 값이 있으면 제목을 새 창 링크로 렌더링하도록 수정했다.
- 링크가 있는 참고자료에는 `열기` 배지를 표시하도록 했다.
- Markdown 목록 표시를 위해 `ul`, `ol`, `li` CSS를 보강했다.
- `_wpack_` JS는 사용자의 요청에 따라 수정 대상에서 제외했다.

### 5. Codex 답변 프롬프트 개선

- `src/generator/answerGenerator.js`에 Codex exec 전용 프롬프트 함수 `buildCodexSupportPrompt()`를 추가했다.
- 실제 답변 생성 경로가 새 프롬프트를 사용하도록 전환했다.
- 핵심 규칙:
  - 고정 인사말과 종료 문구 유지
  - 단순 질문은 짧고 직접적으로 답변
  - 복잡한 오류/버전/설정 질문은 현상 요약, 원인 후보, 확인 방법, 우선 조치, 추가 정보 요청 순서로 답변
  - 근거 우선순위는 MCP/API Guide, 개발가이드/릴리즈, Confluence, W-Tech, Gmail 순서
  - Gmail은 공식 API 확정 근거가 아니라 보조 사례로만 사용
  - 확인되지 않은 API, 속성, 이벤트, 옵션 생성 금지

강제 Markdown 후처리는 답변 품질을 해칠 수 있어 추가 후 제거했다.

## RAG 재생성

raw 원본은 아래 경로에 두고 서버에는 올리지 않는 방향으로 정리했다.

```text
C:\Users\user\Desktop\TechAssistant\data\raw
```

로컬 `ai-answer-remote`에서 외부 raw를 읽어 전체 재생성을 수행했다.

```powershell
node scripts\merge.js --raw-dir "C:\Users\user\Desktop\TechAssistant\data\raw"
node scripts\classify.js
$env:HF_HUB_OFFLINE='1'
$env:TRANSFORMERS_OFFLINE='1'
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" src\rag\indexer.py --reset
```

최종 Chroma 문서 수:

```text
15,810건
```

## 검증 결과

- `node -c scripts\merge.js` 통과
- `node -c src\rag\parseRagResults.js` 통과
- `node -c src\generator\answerGenerator.js` 통과
- W-Tech XML 로컬 파싱 `XML_PARSE_OK`
- `http://localhost:3000/api/health` 정상
- Gmail 검색 확인:

```text
질문: 엑셀 다운로드 오류 메일 문의
결과: Gmail 기술문의 1, 2순위
```

- API Guide 링크 확인:

```text
WebSquare API Guide (AI)
https://docs.inswave.com/support/api/ws5_ai/6.0_0.1550R.20260417.145224/index.html
```

## 서버 반영 대상

서버에 반영할 파일 및 디렉터리:

```text
src/generator/answerGenerator.js
src/rag/parseRagResults.js
src/api/routes/answer.js
scripts/merge.js
data/processed/
data/chroma/
```

W-Tech 화면 반영 대상:

```text
C:\WebSquare_Studio\sp5_x64\websquare_25.0916\workspace\wTech\src\main\webapp\ui\qna\qnaViewAI.xml
```

서버에 올리지 않을 항목:

```text
data/raw/
data/raw/gmail_attachments/
C:\Users\user\Desktop\TechAssistant\data\raw\
```

## 남은 이슈 및 다음 작업

- 답변 품질은 Codex 프롬프트를 개선했지만, 복잡한 질문에서는 추가 검색/rerank 품질이 더 중요하다.
- 다음 단계로는 `searcher.py`에서 API명, 컴포넌트명, 행위 단어를 기준으로 rerank를 보강하는 것이 좋다.
- Gmail source title에 `안녕하세요.` 같은 약한 제목이 일부 남을 수 있어, Gmail title 표시도 추가 보정 여지가 있다.
- W-Tech 화면이 원본 XML이 아니라 패킹된 `_wpack_` 결과를 사용하는 경우, XML 수정 후 별도 빌드/패킹 반영이 필요하다.

## 2026-05-21 17:55 로그 확인

W-Tech DB INSERT 로그에서 AI 답변 원문은 정상 Markdown으로 저장되는 것을 확인했다.

확인된 원문 형태:

```text
1. 동적으로 생성할 컴포넌트를 배치할 부모 컴포넌트 또는 영역을 준비합니다.
2. `dynamicCreate` 호출 시 생성할 컴포넌트 타입과 ID를 지정합니다.
3. 생성 후 필요한 속성은 생성 옵션에 포함하거나, 생성된 컴포넌트 객체에 대해 별도 API로 설정합니다.
4. 이벤트가 필요한 경우 생성 이후 이벤트 바인딩을 추가로 처리합니다.
```

코드 블록도 원문에는 fenced code block 형태로 정상 포함되어 있었다.

```text
```javascript
var comp = $p.dynamicCreate(...)
```
```

따라서 현재 화면에서 번호나 bullet이 보이지 않는 문제는 AI 생성 품질 문제가 아니라 W-Tech 화면 렌더링 또는 CSS 처리 문제로 보는 것이 맞다.

다음 확인 포인트:

- `marked.parse()` 결과가 `<ol><li>` 형태로 변환되는지 확인
- 실제 화면 DOM에 `<ol>`, `<ul>`, `<li>`가 남아 있는지 확인
- DOM에는 목록 태그가 있는데 marker만 안 보이면 CSS 문제
- DOM에서 목록 태그가 사라지면 WebSquare 컴포넌트 `setValue()` 또는 sanitize/render 경로 문제
