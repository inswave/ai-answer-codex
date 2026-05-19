# TechAssistant

AI 기술문의 자동 답변 시스템 — 인스웨이브 WebSquare 기술지원팀의 고객 기술문의에 대해 유사 사례 검색 + 답변 초안을 자동 생성합니다.

> **처음 설치하시는 분은 [설치 및 설정 가이드](docs/setup-guide.md)를 참고하세요.**

## 주요 기능

- **9개 데이터 소스**에서 24,000건+ Q&A 데이터 자동 수집 (Gmail, W-Tech QNA, Confluence, API 가이드 등)
- **RAG 벡터 검색**으로 유사 사례 검색 (ChromaDB + multilingual-e5-base 768차원)
- **Claude API** 기반 답변 초안 자동 생성
- **13개 대분류** 자동 분류 (정규식 룰 엔진)
- **텍스트 전처리** — W-Tech QNA 템플릿 노이즈 제거, 쿼리 전처리, 메타데이터 자동 추출

## 아키텍처

```
[데이터 수집] → [데이터 통합] → [자동 분류] → [RAG 벡터 인덱싱] → [답변 생성]
 src/collectors   scripts/merge.js  src/classifier   src/rag (Python)   src/generator
```

### 데이터 소스

| 소스 | 수집 모듈 | 설명 |
|------|-----------|------|
| Gmail 기술문의 | `gmailCollector.js` | IMAP 2-Phase (UID 경량 검색 → 배치 다운로드) |
| W-Tech QNA | `wtechCollector.js` | Puppeteer 크롤링 |
| Confluence | `confluenceCollector.js` | 5개 스페이스 (Inside, UXDB, 기술지식DB, PA, W5C) |
| API 가이드 | `apiGuideCollector.js` | HTML → JSON 변환 |
| W-Tech FAQ | `wtechFaqCollector.js` | FAQ 크롤링 |

### RAG 파이프라인

| 단계 | 모듈 | 설명 |
|------|------|------|
| 전처리 | `preprocessor.py` | 노이즈 제거, 메타데이터 추출 (version, component) |
| 인덱싱 | `indexer.py` | multilingual-e5-base 임베딩, 100건 배치 + 개별 재시도 |
| 검색 | `searcher.py` | 쿼리 전처리 + 코사인 유사도 상위 8건 |
| 답변 생성 | `answerGenerator.js` | Claude Sonnet 4 API, RAG 컨텍스트 기반 |

## 기술 스택

- **데이터 수집/분류/답변 생성**: Node.js (>=18), Puppeteer, IMAP
- **RAG 벡터 검색**: Python 3.12, ChromaDB, sentence-transformers (multilingual-e5-base)
- **LLM**: Claude Sonnet 4 (Anthropic API)

## 설치

```bash
# Node.js 의존성
npm install

# Python 의존성
pip install -r requirements.txt
```

`config/config.example.json`을 복사하여 `config/config.json`을 생성하고, Gmail App Password 및 Anthropic API Key를 설정합니다.

## 사용법

```bash
# 데이터 수집 (전체)
npm run collect

# 데이터 통합
node scripts/merge.js

# 자동 분류
npm run classify

# RAG 인덱싱 (전체 재인덱싱)
npm run index:reset

# RAG 검색 테스트
python3 src/rag/searcher.py "gridView 셀 병합 방법"

# 답변 생성 (Anthropic API 키 필요)
node scripts/answer.js "기술문의 내용" --version v5.0

# 전체 파이프라인 (수집 → 분류 → 인덱싱)
npm run pipeline
```

## 데이터 흐름

```
Gmail/W-Tech/Confluence → data/raw/*.json
                        → data/processed/all_qa.json (통합)
                        → data/processed/classified_qa.json (분류)
                        → data/chroma/ (벡터 DB)
                        → data/answers/날짜/주제.md (답변 저장)
```

## 프로젝트 구조

```
├── config/                  # 설정 파일
├── data/
│   ├── raw/                 # 소스별 원본 데이터
│   ├── processed/           # 통합/분류 데이터
│   ├── chroma/              # ChromaDB 벡터 DB
│   └── answers/             # 생성된 답변 파일
├── scripts/                 # CLI 스크립트
│   ├── answer.js            # 답변 생성
│   ├── classify.js          # 자동 분류
│   ├── collect.js           # 데이터 수집
│   └── merge.js             # 데이터 통합
├── src/
│   ├── classifier/          # 분류 엔진
│   ├── collectors/          # 데이터 수집 모듈
│   ├── generator/           # 답변 생성 파이프라인
│   ├── parsers/             # 가이드 파서
│   ├── rag/                 # RAG 검색 (Python)
│   │   ├── preprocessor.py  # 텍스트 전처리
│   │   ├── indexer.py       # 벡터 인덱싱
│   │   └── searcher.py      # 시맨틱 검색
│   └── utils/               # 유틸리티
└── CLAUDE.md                # Claude Code 지침
```
