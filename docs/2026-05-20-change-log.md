# 2026-05-20 작업 기록

## 목적

AI 답변 품질을 올리기 위해 다음 작업을 진행했습니다.

- `MEMORY.md` 기반 피드백을 Codex 시스템 프롬프트 앞단에 매 호출 주입
- RAG `$contains`만 보던 API 검증에 로컬 WebSquare API HTML/XML 원본 검색 추가
- W-Tech 문의 첨부 이미지가 ANSWER API까지 전달될 수 있도록 base64 기반 마련
- ANSWER API에서 이미지 첨부를 Tesseract OCR로 읽어 답변 컨텍스트에 포함

## ai-answer-remote 변경

### 메모리 주입

- `src/generator/promptMemory.js`
  - `MEMORY.md` 또는 설정된 메모리 파일을 읽어 시스템 프롬프트에 붙일 텍스트를 생성합니다.
  - 기본 검색 경로:
    - `./MEMORY.md`
    - `%CODEX_HOME%/MEMORY.md`
    - `%CODEX_HOME%/memories/MEMORY.md`
    - `%CODEX_HOME%/memories/feedback.md`
  - `answer.memoryEnabled === false`면 비활성화합니다.
  - `answer.memoryMaxChars`로 주입 길이를 제한합니다.

- `src/generator/answerGenerator.js`
  - `generate()`, `followUp()`, `regenerate()` 호출마다 메모리를 다시 읽어 시스템 프롬프트 앞단에 주입합니다.
  - Codex 호출이 ephemeral이라도 매 요청마다 사용자 피드백이 반영되도록 했습니다.

- `scripts/test_prompt_memory.js`
  - 메모리 파일 탐색, 길이 제한, 비활성화 동작을 검증합니다.

### API HTML 자동 검증

- `src/generator/apiVerifier.js`
  - `apiVerifier.sourceDirs`와 `apiGuide.sourceDir`를 기준으로 로컬 API HTML/XML 문서를 검색합니다.
  - `.html`, `.htm`, `.xml` 파일을 대상으로 API/속성명을 토큰 경계 기반으로 확인합니다.
  - 로컬 문서가 있으면 로컬 문서를 더 권위 있는 근거로 사용합니다.
  - 로컬 문서에서 발견된 항목은 `sourceType: "local-docs"`로 표시합니다.
  - 로컬 문서가 없으면 기존 RAG 검증 결과를 사용합니다.

- `scripts/test_api_verifier_local_docs.js`
  - 임시 HTML 문서로 `displayFormatter`, `getCellData` 검증을 확인합니다.
  - 로컬 문서가 있는 경우 RAG-only 항목이 공식 확인으로 처리되지 않는지 확인합니다.

### 첨부파일 컨텍스트 및 OCR

- `src/generator/attachmentContext.js`
  - 깨진 한글 문구를 정리했습니다.
  - 텍스트 첨부: `.xml`, `.js`, `.css`, `.html`, `.htm`, `.txt`, `.md`
  - 이미지 첨부: `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.svg`
  - 이미지 첨부가 `encoding: "base64"`와 `data`를 포함하면 이미지 payload 수신으로 집계합니다.
  - OCR 결과가 있으면 `## 첨부 이미지 OCR 결과` 섹션으로 답변 컨텍스트에 포함합니다.
  - 라이선스/키/계약/실행 파일 등 위험 가능성이 있는 첨부는 답변 생성에서 제외합니다.

- `src/generator/ocr.js`
  - 이미지 첨부 여부를 확장자 또는 MIME 타입으로 판단합니다.
  - base64 또는 data URL 형식의 이미지 payload를 Buffer로 변환합니다.
  - 임시 파일로 저장한 뒤 `tesseract <file> stdout -l kor+eng` 방식으로 OCR을 실행합니다.
  - 기본 제한:
    - 최대 이미지 3개
    - 이미지당 최대 2MB
    - OCR timeout 30초
  - OCR 실패, payload 없음, 용량 초과는 답변 생성 실패로 번지지 않고 상태값만 남깁니다.

- `src/generator/pipeline.js`
  - 답변 생성 전 `enrichAttachmentsWithOcr()`를 호출하도록 연결했습니다.
  - OCR 성공 텍스트가 포함된 첨부 목록을 `buildQuestionAttachmentContext()`에 전달합니다.
  - 로그에 첨부 수와 OCR 성공/이미지 payload 수를 남깁니다.

- `scripts/test_attachment_context.js`
  - 텍스트 첨부, 이미지 base64 첨부, OCR 성공 이미지, 위험 첨부 차단을 검증합니다.

- `scripts/test_ocr.js`
  - 이미지 판별, base64/data URL 디코딩, OCR 비활성화 동작을 검증합니다.

### 설정

- `config/config.example.json`
  - `apiGuide`, `apiVerifier`, `ocr`, `answer.memory*` 예시 설정을 추가했습니다.

- `config/config.json`
  - 실제 실행 설정에도 `ocr` 설정을 추가했습니다.
  - 이 파일은 저장소에서 무시될 수 있어 `git status`에는 보이지 않을 수 있습니다.

- `package.json`
  - 테스트 스크립트 추가:
    - `test:prompt-memory`
    - `test:api-verifier`
    - `test:attachment-context`
    - `test:ocr`

## W-Tech 변경

위치:

- `C:\WebSquare_Studio\sp5_x64\websquare_25.0916\workspace\wTech`

확인한 기존 구조:

- `src/main/webapp/ui/qna/qnaWriteAI.xml`
  - 신규 문의 등록 시 `ai_attachments`를 구성합니다.
  - 기존에는 텍스트 파일만 `File.text()` 또는 `FileReader`로 읽어 `content`에 담는 흐름이 있었습니다.

- `src/main/java/com/inswave/wtech/support/service/impl/TsInquiryServiceImpl.java`
  - `aiAnswerGenerator.generateAsync(intgId, supportVo.getAi_attachments())`로 신규 문의 첨부를 ANSWER API에 넘깁니다.

- `src/main/java/com/inswave/wtech/support/service/AiAnswerGenerator.java`
  - `attachmentsJson`을 파싱해 ANSWER API 요청 body의 `attachments`로 전달합니다.

- 관리자 재생성 경로는 현재 `generateAsync(intgId)`만 호출하므로 기존 문의 재생성에는 첨부가 같이 넘어가지 않습니다.

적용한 변경:

- `src/main/webapp/ui/qna/qnaWriteAI.xml`
  - 이미지 파일은 `FileReader.readAsDataURL()`로 읽도록 했습니다.
  - 이미지 첨부 메타에 `encoding: "base64"`와 `data`를 저장합니다.
  - `buildAiAttachments()`에서 이미지 payload가 있으면 `encoding`, `data`를 ANSWER API payload에 포함합니다.
  - 기존 개별 파일 1MB, 전체 5MB 제한은 유지했습니다.

주의:

- `_wpack_` 경로도 한 차례 수정되었지만, 사용자가 `_wpack_`은 자동 빌드 산출물이라고 알려주었습니다.
- 앞으로 `_wpack_`은 직접 수정하지 않습니다.
- 다음 WebSquare 빌드에서 `ui/qna/qnaWriteAI.xml` 기준으로 산출물이 다시 만들어지는 흐름을 권장합니다.

## 생성 답변 테스트

문의:

- `multipleExcelUpload drm 적용`
- 등록일: `2026.05.19 17:07:37`
- 프로젝트: `CJENM 온트러스트`
- 핵심 내용: `WebSquare.util.multipleExcelUpload(options)` 사용 시 사내 DRM 정책 때문에 `advancedMultiUpload.html`에서 파일 암호화 실패 알럿 발생. XHR 방식 가능 여부 문의.

실행 결과:

- RAG 결과 8건 사용
- 답변 정책: `needs_context`
- 최초 생성에서 `options.cellDataConvertor` 미확인 항목이 나왔고, 재생성 후 검증 통과
- 저장 경로:
  - `data/answers/2026-05-20/multipleexcelupload_drm_적용등록일2026.05.19_170737작성자[이름]진행_프로젝트.md`
- Queue ID:
  - `20260520-001`

## 서버 OCR 설치 상태

사용자가 원격 서버에서 확인한 내용:

- 경로: `/var/www/html/ser-pr5/ai-answer-codex`
- 최초 `tesseract --version`은 미설치로 표시
- `apt update`는 MySQL/GitLab 저장소 GPG 키 문제로 일부 실패
- `apt install -y tesseract-ocr tesseract-ocr-kor tesseract-ocr-eng`는 성공
- 설치된 주요 패키지:
  - `tesseract-ocr`
  - `tesseract-ocr-kor`
  - `tesseract-ocr-eng`
  - `libtesseract3`

서버에서 추가 확인할 명령:

```bash
tesseract --version
tesseract --list-langs
```

`--list-langs` 결과에 `kor`, `eng`가 있으면 OCR 실행 조건은 갖춰진 상태입니다.

## 검증 완료

아래 명령을 통과했습니다.

```text
node scripts/test_attachment_context.js
node scripts/test_ocr.js
node -e "require('./src/generator/ocr'); require('./src/generator/pipeline'); console.log('module load ok')"
node -e "JSON.parse(require('fs').readFileSync('config/config.example.json','utf8')); JSON.parse(require('fs').readFileSync('config/config.json','utf8')); JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('json ok')"
node scripts/test_answer_policy.js
node scripts/test_prompt_memory.js
node scripts/test_api_verifier_local_docs.js
```

## 현재 git 상태 참고

이번 작업과 별개로 이미 수정 또는 미추적 상태였던 파일도 있습니다.

- `src/api/routes/answer.js`
- `src/api/routes/search.js`
- `src/collectors/index.js`
- `src/rag/sampleMatcher.js`
- `codex-exec-install-notes.md`

위 파일들은 이번 OCR 마무리에서 직접 건드리지 않았습니다.

## 다음 단계

- 서버에 최신 코드를 배포합니다.
- 서버에서 `tesseract --version`, `tesseract --list-langs`를 확인합니다.
- W-Tech에서 이미지 첨부가 포함된 문의를 등록해 ANSWER API request body에 `attachments[].encoding === "base64"`와 `attachments[].data`가 들어오는지 확인합니다.
- ANSWER API 로그에서 `attachments: N, OCR: X/Y`가 찍히는지 확인합니다.
- 실제 캡처 이미지로 답변 컨텍스트에 OCR 문구가 반영되는지 확인합니다.

## 추가 작업: 이미지 OCR 용량 상향

- `C:\WebSquare_Studio\sp5_x64\websquare_25.0916\workspace\wTech\src\main\webapp\ui\qna\qnaWriteAI.xml`
  - AI 분석용 첨부 payload 제한을 파일당 1MB에서 5MB로 상향했습니다.
  - 전체 AI 첨부 payload 제한을 5MB에서 8MB로 상향했습니다.
  - 기존 게시글 파일 업로드 제한과 별개로, ANSWER API에 넘기는 base64 이미지 payload 기준입니다.

- `config/config.json`
  - 로컬 ANSWER API OCR `maxBytes`를 2MB에서 5MB로 상향했습니다.

- `config/config.example.json`
  - 예시 OCR `maxBytes`도 5MB로 맞췄습니다.

- 검증
  - `qnaWriteAI.xml` WebSquare essential 검증 통과
  - `node scripts/test_ocr.js` 통과
  - 로컬 ANSWER API 재기동 완료: `http://127.0.0.1:3000`, PID `26652`

## 추가 작업: OCR 결과 답변 반영 강화

- `src/generator/attachmentContext.js`
  - 깨진 한글 문구를 정리했습니다.
  - OCR 성공 시 `## 첨부 이미지 OCR 활용 지침`을 컨텍스트에 추가합니다.
  - 모델이 OCR 결과를 일반 참고자료처럼 흘리지 않도록, 문의와 관련 있으면 답변 본문에 핵심 문구를 최소 1회 요약하도록 지시합니다.
  - OCR 결과가 불완전해 보이면 단정하지 말고 원본 캡처 확인 필요 문구를 짧게 덧붙이도록 했습니다.

- `scripts/test_attachment_context.js`
  - OCR 활용 지침과 정책 문구가 포함되는지 검증을 추가했습니다.

- 검증
  - `node scripts/test_attachment_context.js` 통과
  - `node scripts/test_ocr.js` 통과
  - `node -e "require('./src/generator/attachmentContext'); require('./src/generator/pipeline'); console.log('module load ok')"` 통과
  - 로컬 ANSWER API 재기동 완료: `http://127.0.0.1:3000`, PID `4644`
