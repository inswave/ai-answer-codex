"""
텍스트 전처리 모듈
- 인덱싱 시: 질문/답변 노이즈 제거 (W-Tech QNA 템플릿, 인사말 등)
- 검색 시: 쿼리에서 핵심 키워드 추출
"""

import re


# ── W-Tech QNA 질문 템플릿 노이즈 패턴 ──
WTECH_TEMPLATE_PATTERNS = [
    # 프로젝트/안내 문구 블록
    r"진행\(투입\)\s*프로젝트\s*[:：].*",
    r"\(\s*필수\s*\)",
    r"기능 문의의 경우.*?바랍니다\.?\s*\)?",
    r"재현이 쉽도록.*?바랍니다\.?\s*\)?",
    r"테스트하신 웹스퀘어.*?주십시오\.?\s*\)?",
    r"추가로 관련 의심사항.*?주십시오\.?\s*\)?",
    r"브라우저 관련인 경우.*?주십시오\.?",
    r"<<\s*작성자\s*정보\s*>>",
    r"<<\s*개요\s*>>",
]

# 답변 인사말/서명 패턴
ANSWER_NOISE_PATTERNS = [
    r"^안녕하세요\.?\s*$",
    r"^안녕하십니까[!.]?\s*$",
    r"^감사합니다\.?\s*$",
    r"^\(주\)인스웨이브.*$",
    r"^인스웨이브\s*기술지원팀.*입니다\.?\s*$",
    r"^\d{4}년\s*\d{1,2}월\s*\d{1,2}일.*작성:?\s*$",
    r"^-{3,}\s*$",
]


def clean_wtech_question(text):
    """W-Tech QNA 질문에서 템플릿 노이즈 제거"""
    if not text:
        return ""

    lines = text.split("\n")
    cleaned = []
    skip_next_empty = False

    for line in lines:
        stripped = line.strip()

        # '>' 단독 라인 제거 (인용 구분자)
        if stripped == ">" or stripped == "":
            if skip_next_empty:
                skip_next_empty = False
                continue
            if stripped == ">":
                continue
            # 빈 줄은 연속 2개까지만 허용
            if cleaned and cleaned[-1] == "":
                continue
            cleaned.append("")
            continue

        # 템플릿 패턴 매칭
        is_template = False
        for pattern in WTECH_TEMPLATE_PATTERNS:
            if re.search(pattern, stripped, re.DOTALL):
                is_template = True
                skip_next_empty = True
                break

        if is_template:
            continue

        # NBSP 정리
        line_clean = stripped.replace("\xa0", " ").replace("\u200b", "").strip()
        if line_clean:
            cleaned.append(line_clean)

    result = "\n".join(cleaned).strip()
    # 앞뒤 빈 줄 정리
    result = re.sub(r"\n{3,}", "\n\n", result)
    return result


def clean_answer(text):
    """답변에서 인사말/서명 노이즈 제거"""
    if not text:
        return ""

    lines = text.split("\n")
    cleaned = []

    for line in lines:
        stripped = line.strip()

        is_noise = False
        for pattern in ANSWER_NOISE_PATTERNS:
            if re.match(pattern, stripped):
                is_noise = True
                break

        if is_noise:
            continue

        cleaned.append(line)

    result = "\n".join(cleaned).strip()
    result = re.sub(r"\n{3,}", "\n\n", result)
    return result


def clean_question(text, source=""):
    """소스별 질문 정리"""
    if not text:
        return ""

    if source == "W-Tech QNA" or source == "W-Tech FAQ":
        return clean_wtech_question(text)

    # Gmail — 이메일 헤더/서명 정리
    if "Gmail" in source:
        text = re.sub(r"\d{4}년\s*\d{1,2}월.*?작성:\s*$", "", text, flags=re.MULTILINE)
        text = re.sub(r"\[URL\]", "", text)

    return text.strip()


def extract_version(text):
    """텍스트에서 WebSquare 버전 정보 추출"""
    patterns = [
        r"(?:version|버전)\s*[:：]?\s*([\d._]+[BS]?[\d.]*)",
        r"(\d+\.\d+_\d+\.\d+[BS]?\.\d+\.\d+_\d+\.\d+)",
        r"(?:SP|sp)\s*(\d)",
        r"(?:웹스퀘어|WebSquare)\s*(?:AI\s*)?([\d.]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(0).strip()
    return ""


def extract_component(text):
    """텍스트에서 주요 컴포넌트명 추출"""
    components = [
        "gridView", "inputCalendar", "scheduleCalendar", "windowContainer",
        "tabControl", "autoComplete", "selectBox", "inputBox", "textBox",
        "textArea", "trigger", "dataList", "dataMap", "submission",
        "wframe", "calendar", "multiupload", "fileUpload", "editor",
        "checkbox", "radio", "linkedDataList", "chart", "popupWindow",
    ]
    found = []
    text_lower = text.lower()
    for comp in components:
        if comp.lower() in text_lower:
            found.append(comp)
    return found[0] if found else ""


def preprocess_query(query):
    """
    검색 쿼리 전처리 — 고객 문의에서 핵심 키워드 추출

    W-Tech QNA 템플릿 제거 + 핵심 내용만 남김
    """
    # 먼저 W-Tech 템플릿 노이즈 제거
    cleaned = clean_wtech_question(query)

    # 엔진 버전 정보 줄 제거 (검색에 노이즈)
    cleaned = re.sub(
        r"(?:version|버전|엔진|engine).*?[\d._]+[BS]?[\d.]*.*$",
        "",
        cleaned,
        flags=re.MULTILINE | re.IGNORECASE,
    )
    # 첨부파일 관련 문구 제거
    cleaned = re.sub(r"첨부.*?(?:참고|확인).*?(?:부탁|바랍니다).*$", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"파일\s*업로드\s*갯수.*$", "", cleaned, flags=re.MULTILINE)

    # 빈 줄 정리
    cleaned = re.sub(r"\n{2,}", "\n", cleaned).strip()

    return cleaned


def make_clean_document(item):
    """
    인덱싱용 정제된 문서 텍스트 생성

    Returns:
        str: 정제된 "질문: ...\n답변: ...\n분류: ..." 텍스트
    """
    source = item.get("source", "")

    parts = []
    question = clean_question(item.get("question", ""), source)
    if question:
        parts.append(f"질문: {question}")

    answer = clean_answer(item.get("answer", ""))
    if answer:
        parts.append(f"답변: {answer[:2000]}")

    category = item.get("categoryLabel", item.get("category", ""))
    if category:
        parts.append(f"분류: {category}")

    return "\n".join(parts)


def extract_metadata(item):
    """확장 메타데이터 추출"""
    import json as _json

    question = item.get("question", "")
    answer = item.get("answer", "")
    full_text = question + " " + answer

    metadata = {
        "category": item.get("categoryLabel", item.get("category", "")),
        "subcategory": item.get("subcategoryLabel", item.get("subcategory", "")),
        "source": item.get("source", ""),
        "question": clean_question(question, item.get("source", ""))[:500],
        "version": extract_version(full_text),
        "component": extract_component(full_text),
    }

    # ChromaDB는 batch 내 metadata 키가 일관되어야 정상 update됨.
    # 따라서 url/attachments/attachmentDir은 빈 값이라도 항상 키 포함.
    metadata["url"] = item.get("url", "")

    attachments = item.get("attachments")
    if attachments and isinstance(attachments, list) and len(attachments) > 0:
        metadata["attachments"] = _json.dumps(attachments, ensure_ascii=False)
    else:
        metadata["attachments"] = ""

    metadata["attachmentDir"] = item.get("attachmentDir", "")

    return metadata
