#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI 릴리즈 노트 PDF → 페이지 단위 QA JSON 파서 (방식 A)

설계: docs/superpowers/specs/2026-06-30-ai-release-note-pdf-ingest-design.md

페이지당 1문서. 주차 헤더 페이지는 current_week 를 갱신하고,
연속(상세) 페이지는 직전 주차 컨텍스트를 이어받아 컴포넌트명을 제목에 붙인다.

출력: data/processed/ai_release_note_pdf.raw.json
      [{ question, answer, source, url, date, tags, week, component }, ...]
분류(category)는 이후 JS 분류 단계에서 부여한다.

실행:
  <python(pypdf 설치된)> scripts/parse_ai_release_note_pdf.py \
      --pdf "C:/Users/user/Downloads/웹스퀘어 AI 릴리즈 노트.pdf" \
      [--limit 60]   # 일부 페이지만(테스트)
"""

import argparse
import json
import os
import re
import sys

try:
    from pypdf import PdfReader
except ImportError:
    print("pypdf 가 필요합니다. (pypdf 설치된 python 으로 실행하세요)", file=sys.stderr)
    sys.exit(1)

DEFAULT_SOURCE = "WebSquare AI 릴리즈 노트"
DEFAULT_URL = "https://docs1.inswave.com/ai_release_note"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, "data", "processed", "ai_release_note_pdf.raw.json")

HEADER_RE = re.compile(r"(20\d{2})\s*-\s*Week\s*(\d+)\s*\(([^)]*)\)")
CONT_RE = re.compile(r"^(.+?)\s*\|\s*\d+\s*$")          # 'GridView | 5'
PAGENO_PREFIX_RE = re.compile(r"^[\d,]+\s*\|\s*")         # '1,012 | '
BUILD_DATE_RE = re.compile(r"(20\d{2})(\d{2})(\d{2})")    # YYYYMMDD

# merge.js extractTags 와 동일한 태그 패턴
TAG_PATTERNS = [
    "gridview", "grid", "엑셀", "excel", "selectbox", "calendar", "input",
    "popup", "tab", "dataset", "submission", "ajax", "라이선스", "license",
    "보안", "xss", "servlet", "jakarta", "poi", "업로드", "다운로드",
]

# 하이퍼링크 화이트리스트(허용 도메인 → 종류) / 블랙리스트
LINK_ALLOW = [
    ("docs1.inswave.com", "doc"),         # 공식 문서 딥링크
    ("example.websquare.kr", "sample"),   # 라이브 실행 샘플
    ("youtu.be", "video"),
    ("youtube.com", "video"),
    ("developer.mozilla.org", "ref"),
]
LINK_BLOCK = ["atlassian.net"]            # 사내 JIRA/위키 — 고객 노출 금지


def _host(u):
    m = re.match(r"https?://([^/]+)", u or "")
    return m.group(1).lower() if m else ""


def extract_filtered_links(page):
    """페이지의 URI 링크 주석을 추출하여 허용 도메인만 [{type,url}] 로 반환."""
    found = []
    annots = page.get("/Annots")
    if not annots:
        return found
    try:
        annots = annots.get_object()
    except Exception:
        pass
    seen = set()
    for a in annots:
        try:
            o = a.get_object()
            A = o.get("/A")
            uri = A.get_object().get("/URI") if A else None
        except Exception:
            continue
        if not uri:
            continue
        uri = str(uri).strip()
        for cut in ("&#34;", "&34;", "&quot;", '"', "'"):
            uri = uri.split(cut)[0]
        sec = uri.find("http", 5)          # 중첩 URL 깨짐 → 두 번째 http 이후 제거
        if sec != -1:
            uri = uri[:sec]
        uri = uri.strip()
        if not uri.startswith("http"):
            continue
        host = _host(uri)
        if any(b in host for b in LINK_BLOCK):
            continue
        kind = next((k for dom, k in LINK_ALLOW if dom in host), None)
        if not kind or uri in seen:
            continue
        seen.add(uri)
        found.append({"type": kind, "url": uri})
    return found


def extract_tags(text):
    low = (text or "").lower()
    tags = []
    for p in TAG_PATTERNS:
        if p.lower() in low and p not in tags:
            tags.append(p)
    return tags


def clean_body(text):
    """줄바꿈/공백 정리 + 단어 중간 끊김 보수적 봉합."""
    if not text:
        return ""
    s = text.replace("\r\n", "\n").replace("\r", "\n")
    s = s.replace(" ", " ").replace("​", "")
    lines = [ln.strip() for ln in s.split("\n")]
    # 빈 줄/페이지번호 잡음 라인 정리
    cleaned = []
    for ln in lines:
        if not ln:
            continue
        cleaned.append(ln)
    s = "\n".join(cleaned)
    # 'WAE\nA-274' 처럼 티켓ID가 줄바꿈으로 끊긴 경우 봉합
    s = re.sub(r"([A-Z]{2,})\n([A-Z]?-?\d+)", r"\1\2", s)
    # 영문 하이픈 끊김 'down-\nload' → 'download'
    s = re.sub(r"([A-Za-z])-\n([A-Za-z])", r"\1\2", s)
    # 3줄 이상 연속 공백 축소
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def parse_date(version_or_text):
    m = BUILD_DATE_RE.search(version_or_text or "")
    if m:
        return "%s-%s-%s" % (m.group(1), m.group(2), m.group(3))
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--source", default=DEFAULT_SOURCE, help="source 라벨 (예: WebSquare SP5 릴리즈 노트)")
    ap.add_argument("--url", default=DEFAULT_URL, help="원본 docs URL")
    ap.add_argument("--limit", type=int, default=0, help="앞 N페이지만 처리(테스트)")
    args = ap.parse_args()
    source = args.source
    url = args.url

    if not os.path.exists(args.pdf):
        print("PDF 없음: %s" % args.pdf, file=sys.stderr)
        sys.exit(1)

    reader = PdfReader(args.pdf)
    n = len(reader.pages)
    if args.limit:
        n = min(n, args.limit)

    results = []
    cur_label = ""      # '2025 - Week 31 (6.0_0.1309B...)'
    cur_date = ""
    skipped = 0
    header_pages = 0
    cont_pages = 0
    orphan = 0          # 주차 컨텍스트 없는 연속 페이지

    for i in range(n):
        raw = reader.pages[i].extract_text() or ""
        body = clean_body(raw)
        if len(body) < 30:
            skipped += 1
            continue

        first = body.split("\n", 1)[0].strip()
        first = PAGENO_PREFIX_RE.sub("", first)

        hm = HEADER_RE.search(body[:160])
        if hm:
            year, week = hm.group(1), hm.group(2)
            version = re.sub(r"\s+", " ", hm.group(3)).strip()
            cur_label = "%s - Week %s (%s)" % (year, week, version)
            cur_date = parse_date(version) or parse_date(body[:200])
            question = cur_label
            component = ""
            header_pages += 1
        else:
            cont_pages += 1
            cm = CONT_RE.match(first)
            component = cm.group(1).strip() if cm else ""
            if cur_label:
                question = ("%s - %s" % (cur_label, component)).strip(" -") if component \
                    else cur_label
            else:
                # 주차 컨텍스트 못 잡은 초반 페이지 — 컴포넌트/첫줄로 대체
                orphan += 1
                question = component or first[:80]

        if not question or len(question) < 3:
            skipped += 1
            continue

        page_links = extract_filtered_links(reader.pages[i])
        deep = next((l["url"] for l in page_links if l["type"] == "doc"), "")

        item = {
            "question": question,
            "answer": body,
            "source": source,
            "url": deep or url,          # 페이지 딥링크 우선, 없으면 가이드 기본 URL
            "date": cur_date,
            "tags": extract_tags(question + " " + body),
            "links": page_links,         # 분류된 링크들(딥링크/샘플/영상)
            "week": cur_label,
            "component": component,
            "page": i + 1,
        }
        results.append(item)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print("=" * 55)
    print("총 페이지: %d  (처리범위 %d)" % (len(reader.pages), n))
    print("문서 생성: %d건" % len(results))
    print("  헤더 페이지: %d / 연속 페이지: %d / 스킵: %d / 주차미상: %d"
          % (header_pages, cont_pages, skipped, orphan))
    print("저장: %s" % args.out)
    # 날짜 분포(연도)
    yc = {}
    for it in results:
        y = (it["date"] or "")[:4] or "미상"
        yc[y] = yc.get(y, 0) + 1
    print("연도 분포:", {k: yc[k] for k in sorted(yc)})
    print("-" * 55)
    print("샘플 3건:")
    for it in results[:3]:
        print("  Q:", it["question"][:70])
        print("     date=%s tags=%s comp=%s" % (it["date"], it["tags"], it["component"]))
        print("     A:", it["answer"][:120].replace("\n", " "), "...")


if __name__ == "__main__":
    main()
