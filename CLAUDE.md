# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI 기술문의 자동 답변 시스템 — 인스웨이브 WebSquare 기술지원팀이 고객 기술문의에 대해 유사 사례 검색 + 답변 초안을 자동 생성하는 시스템. 9개 데이터 소스에서 24,962건의 통합 데이터를 수집·분류·인덱싱하여 활용.

## Tech Stack

- **데이터 수집/분류/답변 생성**: Node.js (>=18), Puppeteer, IMAP
- **RAG 벡터 검색**: Python 3.12, ChromaDB, sentence-transformers (MiniLM)
- **LLM**: Claude Sonnet 4 (Anthropic API) — answer.js 사용 시 API 키 필요. Claude Code로 RAG 검색 후 직접 답변 생성도 가능 (추가 과금 없음).

## Commands

```bash
# 설치
npm install
pip install -r requirements.txt

# 데이터 수집 (전체 / 개별)
npm run collect
npm run collect:gmail
npm run collect:wtech

# 데이터 통합 (data/raw/ → data/processed/all_qa.json)
node scripts/merge.js

# 자동 분류 (13개 대분류)
npm run classify

# RAG 인덱싱
npm run index          # 증분 인덱싱
npm run index:reset    # 전체 재인덱싱

# RAG 검색 테스트
python3 src/rag/searcher.py "gridView 셀 병합 방법"

# 답변 생성 (Anthropic API 키 필요)
node scripts/answer.js "기술문의 내용" --version v5.0

# 전체 파이프라인 (수집→분류→인덱싱)
npm run pipeline
```

## Architecture

5개 핵심 모듈이 순차 파이프라인으로 연결:

```
[데이터 수집] → [데이터 통합] → [자동 분류] → [RAG 벡터 인덱싱] → [답변 생성]
 src/collectors   scripts/merge.js  src/classifier   src/rag (Python)   src/generator
```

### 1. 데이터 수집 (`src/collectors/`)
9개 소스에서 Q&A 데이터를 자동 크롤링하여 `data/raw/`에 저장.
- `gmailCollector.js` — IMAP 2-Phase 방식 (UID 경량 검색 → 30건 배치 다운로드), Gmail X-GM-RAW 7개 병렬 쿼리
- `wtechCollector.js` — W-Tech QNA 게시판 Puppeteer 크롤링
- `confluenceCollector.js` — Confluence 5개 스페이스 (Inside, UXDB, 기술지식DB, PA, W5C)
- `apiGuideCollector.js` — WebSquare API 가이드 HTML→JSON 변환
- `wtechFaqCollector.js` — W-Tech FAQ 크롤링
- `legacy/` — 기존 크롤링 스크립트 26개 (참고용, `C:/inswave/crawling/scripts/`에서 이관)

### 2. 데이터 통합 (`scripts/merge.js`)
`data/raw/`의 각 소스별 원본 데이터를 통합 QA 포맷(`{ question, answer, source, date, tags }`)으로 변환하여 `data/processed/all_qa.json`에 저장. 중복 제거 포함. 크롤링 없이 통합만 수행.

### 3. 자동 분류 (`src/classifier/`)
정규식 기반 룰 엔진으로 13개 대분류로 자동 분류. 카테고리별 대표 Q&A 다이제스트 자동 생성.
- `categories.js` — 분류 체계 정의 (패턴, 대/소분류)
- `classifier.js` — 분류 엔진
- `digestGenerator.js` — 다이제스트 생성기

### 4. RAG 벡터 검색 (`src/rag/`, Python)
- `indexer.py` — ChromaDB + MiniLM 다국어 임베딩 (384차원), 100건 배치 + 개별 재시도
- `searcher.py` — 코사인 유사도 검색, 상위 8건 컨텍스트 구성

### 5. 답변 생성 (`src/generator/`)
- `answerGenerator.js` — Claude API 호출, RAG 상위 8건(건당 최대 2,000자)을 컨텍스트로 전달. `config.json`의 답변 템플릿 자동 적용. RAG 결과 없을 시 일반 지식 기반 답변 + 면책 표기.
- `pipeline.js` — 분류→RAG검색→답변생성 전체 파이프라인. Python 경로는 `PYTHON_PATH` 환경변수 또는 Windows 자동 감지.

## Configuration

`config/config.example.json`을 복사하여 `config/config.json` 생성. Gmail App Password, Anthropic API Key 등 인증 정보 설정 필요.

### 답변 템플릿 설정 (`config.json` → `answer`)
```json
{
  "answer": {
    "responderName": "담당자명",
    "template": "안녕하세요.\n인스웨이브 기술지원팀 {{name}} 프로입니다.\n\n{{topic}}과 관련하여 확인 후 답변드립니다.\n\n{{content}}\n\n감사합니다."
  }
}
```

## 답변 생성 파이프라인 (공통)

Claude Code / answer.js / FastAPI 서버 모두 동일한 파이프라인을 따른다.

```
1. RAG 검색 — searcher.py로 유사 사례 검색 (쿼리 전처리 적용)
2. 답변 초안 생성 — RAG 결과 기반 답변 작성
3. API 검증 — 답변에 포함된 모든 API/이벤트/속성명을 RAG DB에서 $contains 검색으로 존재 확인
4. 미확인 API 발견 시 → 해당 API 제외하고 답변 재생성 (최대 3회)
5. 답변 파일 저장 — data/answers/날짜/주제.md
```

### Claude Code에서 답변 시 절차
1. `python src/rag/searcher.py "문의 내용"` 으로 RAG 검색
2. 검색 결과 기반으로 답변 초안 작성
3. 답변에 사용된 API/이벤트/속성명을 RAG DB에서 `$contains` 검색으로 검증
4. 미확인 API 발견 시 → 실제 존재하는 API로 교체하여 답변 수정
5. `data/answers/날짜/주제.md` 파일로 저장

### answer.js 파이프라인 자동 절차
1. 문의 분류 (classifier)
2. RAG 검색 (searcher.py)
3. Claude API로 답변 생성 (answerGenerator.js)
4. API 검증 (apiVerifier.js) — 미확인 API 발견 시 자동 재생성 (최대 3회)
5. 답변 파일 자동 저장 (pipeline.js)

## 답변 생성 규칙

### RAG 검색 결과가 있을 때
- 반드시 참고자료(RAG 검색 결과) 기반으로만 답변. 추측 금지.
- 답변 구조: 원인 분석 → 해결 방법 → 추가 확인 사항
- 모든 답변에 출처 표기 필수: `[데이터 유형] + [출처 위치] + [세부 항목] + [버전/시점]`

### RAG 검색 결과가 없을 때
- WebSquare 공식 문서 및 일반적인 기술 지식 기반으로 답변 가능
- 답변 본문 앞에 면책 문구 필수: "※ 내부 데이터 기준 확인된 사례가 없어, WebSquare 공식 문서 및 일반적인 기술 지식을 기반으로 안내드립니다. 정확한 내용은 추가 확인이 필요할 수 있습니다."
- 출처를 "WebSquare 공식 문서 기반 일반 안내"로 표기. 내부 데이터 출처를 임의로 만들지 않는다.
- 답변 끝에 추가 정보 요청 포함 (버전, 에러 로그, 재현 방법)

### 코드 예시 규칙
- RAG 참고자료에 코드 예시가 있으면 해당 코드를 우선 활용한다 (검증된 코드)
- 참고자료에 정확히 매칭되는 코드가 없어 새로 작성하는 경우, 코드 아래에 반드시 표기: "※ 위 코드는 유사 사례 기반 참고용입니다. 실제 동작 확인 후 적용해주세요."
- WebSquare 엔진에서만 동작하는 코드는 직접 테스트할 수 없으므로, 검증되지 않은 코드임을 명시한다

### 버전 정보 검증 규칙
- RAG 데이터에서 추출한 소프트웨어 버전(POI, Spring, JDK 등)이 실제 존재하는 버전인지 반드시 확인한다.
- 엔진 파일명에서 버전을 추출할 때, 아래 네이밍 규칙을 따른다.

**WebSquare 엔진 파일명 네이밍 규칙:**
```
{엔진버전}_{빌드날짜}_{옵션}_without_testcase.zip

예시:
6.0_0.1273B.20250611.101354_poi4_1.8_without_testcase.zip
→ 엔진: 6.0_0.1273B
→ 빌드: 20250611
→ poi4 = POI 4.x 버전으로 컴파일 (실제 POI 버전은 4.1.2)
→ 1.8 = Java 1.8 (JDK 버전)
→ "POI 4.1.8"이 아님에 주의!

5.0_5.5261B.20241203.142606_poi4_1.8
→ SP5 엔진, POI 4.x + Java 1.8

6.0_0.1273B.20250611.101354_servlet5_without_testcase.zip
→ servlet5 = Servlet 5 (SpringBoot 3 / Spring Framework 6 대응)
```

**주요 라이브러리 실제 릴리즈 버전 (참고):**
- Apache POI: 3.10, 3.16, 3.17, 4.0.1, 4.1.0, 4.1.1, 4.1.2 (4.x 마지막), 5.0.0, 5.1.0, 5.2.x, 5.3.0, 5.4.0
- xmlbeans: 2.3.0, 2.6.0 (POI 3.x), 3.1.0 (POI 4.x), 5.x (POI 5.x)

### 공통
- WebSquare 버전, POI/servlet 버전 호환성 반드시 고려
- 개인정보(이름, 이메일, 회사명, 프로젝트명) 절대 포함 금지 — `src/utils/masking.js`로 마스킹
- 답변은 `config.json`의 템플릿 형식을 따른다

## Data Flow

```
Gmail/W-Tech/Confluence → data/raw/*.json
                        → data/processed/all_qa.json (통합, 24,962건)
                        → data/processed/classified_qa.json (분류)
                        → data/processed/category_digests.json (다이제스트)
                        → data/chroma/ (벡터 DB)
                        → data/answers/날짜/주제.md (답변 저장)
```
