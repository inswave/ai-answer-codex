#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
개발 가이드 PDF → 페이지 단위 QA JSON 파서 (방식 A, 장(章) 기반)

릴리즈 노트와 달리 개발 가이드는 Week 헤더가 없고, 러닝 헤더가
  "페이지번호 | 장이름"  (예: '56 | MFE', '256 | 내장 컴포넌트')
  또는 "장이름 | 페이지번호"
형식이다. 장(章)을 컨텍스트로 잡고, 페이지 첫 본문 줄을 소제목으로 붙인다.

출력: data/processed/<out>.raw.json
      [{ question, answer, source, url, date(빈값), tags, chapter, page }, ...]
분류(category)는 이후 classify_json.js 에서 부여.

실행:
  <python(pypdf)> scripts/parse_dev_guide_pdf.py \
      --pdf "...AI 가이드.pdf" \
      --source "WebSquare 개발 가이드 (AI)" \
      --url "https://docs1.inswave.com/ai_user_guide" \
      --out data/processed/ai_dev_guide_pdf.raw.json [--limit 60]
"""

import argparse
import json
import os
import re
import sys

try:
    from pypdf import PdfReader
except ImportError:
    print("pypdf 가 필요합니다.", file=sys.stderr)
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CONT_L = re.compile(r"^(.+?)\s*\|\s*\d+\s*$")   # '장이름 | 56'
CONT_R = re.compile(r"^\d+\s*\|\s*(.+?)\s*$")    # '56 | 장이름'
ROMAN_RE = re.compile(r"^[ivxlcdm]+(\s*\|.*)?$", re.IGNORECASE)  # 목차 로마숫자 페이지
SKIP_CHAPTERS = {"차례", "목차", "표 차례", "그림 차례"}

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
    out = []
    for p in TAG_PATTERNS:
        if p.lower() in low and p not in out:
            out.append(p)
    return out


def clean_body(text):
    if not text:
        return ""
    s = text.replace("\r\n", "\n").replace("\r", "\n")
    s = s.replace(" ", " ").replace("​", "")
    lines = [ln.strip() for ln in s.split("\n") if ln.strip()]
    s = "\n".join(lines)
    s = re.sub(r"([A-Z]{2,})\n([A-Z]?-?\d+)", r"\1\2", s)
    s = re.sub(r"([A-Za-z])-\n([A-Za-z])", r"\1\2", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def detect_chapter(first_line):
    """러닝 헤더에서 장(章) 이름 추출. (양쪽 포맷 지원)"""
    m = CONT_R.match(first_line)
    if m:
        return m.group(1).strip()
    m = CONT_L.match(first_line)
    if m:
        return m.group(1).strip()
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--source", required=True)
    ap.add_argument("--url", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    if not os.path.exists(args.pdf):
        print("PDF 없음: %s" % args.pdf, file=sys.stderr)
        sys.exit(1)

    reader = PdfReader(args.pdf)
    n = len(reader.pages)
    if args.limit:
        n = min(n, args.limit)

    results = []
    cur_chapter = ""
    skipped = 0
    toc_skipped = 0

    for i in range(n):
        body = clean_body(reader.pages[i].extract_text() or "")
        if len(body) < 40:
            skipped += 1
            continue

        lines = body.split("\n")
        first = lines[0].strip()

        # 목차/로마숫자 페이지 스킵
        if ROMAN_RE.match(first) or first in SKIP_CHAPTERS:
            toc_skipped += 1
            continue

        chapter = detect_chapter(first)
        if chapter in SKIP_CHAPTERS:
            toc_skipped += 1
            continue
        if chapter:
            cur_chapter = chapter

        # 소제목 = 러닝헤더 다음의 첫 본문 줄
        subheading = ""
        for ln in lines[1:]:
            t = ln.strip()
            if t and not ROMAN_RE.match(t):
                subheading = t
                break

        title_chapter = cur_chapter or "개발 가이드"
        if subheading and subheading[:60] != title_chapter:
            question = "%s - %s: %s" % (args.source, title_chapter, subheading[:80])
        else:
            question = "%s - %s" % (args.source, title_chapter)

        page_links = extract_filtered_links(reader.pages[i])
        deep = next((l["url"] for l in page_links if l["type"] == "doc"), "")

        results.append({
            "question": question,
            "answer": body,
            "source": args.source,
            "url": deep or args.url,      # 페이지 딥링크 우선, 없으면 가이드 기본 URL
            "date": "",
            "tags": extract_tags(question + " " + body),
            "links": page_links,         # 분류된 링크들(딥링크/샘플/영상)
            "chapter": cur_chapter,
            "page": i + 1,
        })

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print("=" * 55)
    print("총 페이지: %d (처리 %d)" % (len(reader.pages), n))
    print("문서 생성: %d건  (스킵 %d / 목차스킵 %d)" % (len(results), skipped, toc_skipped))
    print("저장: %s" % args.out)
    # 장(章) 분포 상위
    cc = {}
    for it in results:
        cc[it["chapter"]] = cc.get(it["chapter"], 0) + 1
    top = sorted(cc.items(), key=lambda kv: kv[1], reverse=True)[:12]
    print("주요 장(章):")
    for ch, c in top:
        print("  %4d  %s" % (c, ch or "(미상)"))
    print("-" * 55)
    print("샘플 3건:")
    for it in results[:3]:
        print("  Q:", it["question"][:90])
        print("     A:", it["answer"][:110].replace("\n", " "), "...")


if __name__ == "__main__":
    main()
