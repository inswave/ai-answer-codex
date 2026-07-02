# AI 릴리즈 노트 PDF 수집·인덱싱 설계

- 작성일: 2026-06-30
- 상태: 설계 확정 (구현 대기)

## 배경 / 문제

현재 벡터 DB의 AI 릴리즈 노트 데이터는 품질이 낮다.

- SPA(`docs1.inswave.com/ai_release_note`) JS 파싱으로 수집된 69건
  - `WebSquare 릴리즈 노트 (AI)` 63건 + `WebSquare AI 릴리즈 노트` 6건
- 본문이 한 줄로 뭉쳐짐 (`1.1요약1.1.1스튜디오 정보...`) — 줄바꿈·구분 소실
- `date` 필드 비어있음
- 범위가 2026년 초 위주

사용자가 받은 PDF(`웹스퀘어 AI 릴리즈 노트.pdf`, 약 20MB)는 훨씬 풍부하다.

- 1,927페이지 중 1,877페이지(97%)에서 텍스트 추출됨 (총 약 117만 자)
- 범위: 2024 Week 17 → 2026
- 구조 보존: `주차/버전 → 컴포넌트 → 기능/변경/버그 → 설명 + JIRA 티켓ID(WAEA-277 등)`

## 목표

PDF를 페이지(주차) 단위로 파싱하여 깔끔한 릴리즈 노트 문서를 벡터 DB에 **추가**한다(add-only).
기존 69건은 삭제하지 않고 공존시킨다(사용자 결정).

## 비범위 (Non-goals)

- 기존 69건 삭제/교체 (이번엔 추가만)
- 컴포넌트 단위·항목 단위 정밀 분해 (향후 고도화 여지로 남김; 이번은 페이지 단위)
- 운영 merge 재실행 (raw 부족으로 all_qa.json 파괴 위험 — 절대 금지)

## 설계

### 1. 파서 — 페이지 단위 (방식 A)

입력: `웹스퀘어 AI 릴리즈 노트.pdf`
출력: `data/processed/ai_release_note_pdf.json` (QA 포맷 배열)

페이지당 1문서:

- `question`: 주차/버전 헤더. 예) `2025 - Week 31 (6.0_0.1309B.20250722.160934)`
  - 페이지 선두의 페이지번호 프리픽스(`1,012 | `)는 제거
- `answer`: 페이지 본문 정리
  - 줄바꿈 복원, 과도한 공백 정리
  - 단어 중간 끊김 봉합 (예: `WAE\nA-274` → `WAEA-274`)
- `date`: 버전 문자열의 빌드날짜 8자리(`20250722`) → `2025-07-22`
- `source`: `WebSquare AI 릴리즈 노트`
- `url`: `https://docs1.inswave.com/ai_release_note`
- `tags`: 기존 `extractTags` 규칙 재활용
- 필터: 추출 텍스트 30자 미만 페이지(표지/이미지) 스킵

파싱은 pypdf(Python, 설치됨)로 수행. 텍스트 추출 품질이 들쭉날쭉하므로
봉합/정리는 보수적으로(내용 손실 없이) 적용.

### 2. 분류

파서 산출 JSON을 분류기에 통과시켜 `category/subcategory` 부여.
(`prepare_account2_for_index.js` 의 분류 패턴 재사용 가능)

### 3. 증분 인덱싱 (add-only)

- `indexer.py --data data/processed/ai_release_note_pdf.json` (--reset 없음)
- 내용 해시 기반 doc_id → 기존 16,146건 + 릴리즈노트 69건 유지, PDF분만 신규 추가
- 운영 반영은 `index_account2_on_prod.sh` 패턴 재사용 (백업 → 증분 인덱싱 → RAG 재시작)

## 데이터 흐름

```
웹스퀘어 AI 릴리즈 노트.pdf
  → scripts/parse_ai_release_note_pdf.(py)  → ai_release_note_pdf.json
  → 분류                                     → (category 부여)
  → indexer.py --data (증분)                 → ChromaDB (+PDF 페이지분)
  → RAG 상주 서버 재시작                       → 검색 반영
```

## 검증

- 파싱 직후: 생성 건수, 연도/날짜 분포, 샘플 5건 출력 → 기존 깨진 데이터와 대조
- 인덱싱 전/후 컬렉션 건수 차이 = 신규 반영분 확인
- 검색 테스트: "GridView 열 병합 언제 추가" 등으로 해당 주차 문서 매칭 확인

## 위험 / 안전장치

- ChromaDB는 인덱싱 전 백업 (`data/chroma.bak.*`)
- `--reset` 절대 사용 금지 (16,146 → 파괴 위험)
- 운영 merge 실행 금지 (all_qa.json 979 파괴)
- PDF 텍스트 봉합은 보수적으로 — 과도한 정규식으로 내용 훼손 주의

## 향후 고도화 (이번 범위 아님)

- 방식 C(컴포넌트 × 주차) 또는 B(항목 단위)로 파서 교체 시 정밀 검색 강화
- 데이터는 그대로 두고 파서만 교체 가능한 구조 유지
