#!/usr/bin/env python
"""
metadata만 빠르게 update하는 스크립트.
임베딩은 그대로 두고 metadata만 ChromaDB.update()로 갱신.

용도: merge.js / classify.js로 metadata 변경됐을 때 재인덱싱 (30분+) 없이 5분 내 갱신.
사용: python scripts/update_metadata.py
"""

import json
import hashlib
import os
import sys
import io
from pathlib import Path

# Windows cp949 인코딩 에러 방지
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import chromadb

ROOT = Path(__file__).parent.parent
PROCESSED_DIR = ROOT / 'data' / 'processed'
CHROMA_DIR = str(ROOT / 'data' / 'chroma')
COLLECTION_NAME = 'techassistant_qa'
BATCH_SIZE = 500

sys.path.insert(0, str(ROOT / 'src' / 'rag'))
from preprocessor import extract_metadata


def make_doc_id(item):
    """indexer.py와 동일한 ID 생성 로직"""
    key = (item.get("question", "") + "|" + item.get("answer", "")[:200]).encode("utf-8")
    return "doc_" + hashlib.md5(key).hexdigest()[:12]


def main():
    print(f"[metadata-update] classified_qa.json 로드 중...")
    with open(PROCESSED_DIR / 'classified_qa.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    print(f"[metadata-update] 총 {len(data)}건")

    # ChromaDB 연결
    client = chromadb.PersistentClient(path=CHROMA_DIR)
    coll = client.get_collection(COLLECTION_NAME)
    existing_count = coll.count()
    print(f"[metadata-update] ChromaDB 컬렉션: {existing_count}건")

    if existing_count == 0:
        print("[metadata-update] 컬렉션이 비어있음 — indexer.py로 처음부터 인덱싱 필요")
        sys.exit(1)

    # 기존 ChromaDB ID 셋
    existing_ids = set(coll.get()["ids"])
    print(f"[metadata-update] 기존 ID 셋 로드: {len(existing_ids)}")

    # 항목별 (id, metadata) 준비 — 기존에 있는 ID만
    pairs = []
    skipped_no_id = 0
    for item in data:
        doc_id = make_doc_id(item)
        if doc_id not in existing_ids:
            skipped_no_id += 1
            continue
        meta = extract_metadata(item)
        pairs.append((doc_id, meta))

    print(f"[metadata-update] 갱신 대상: {len(pairs)}건 (ChromaDB에 없어 스킵: {skipped_no_id})")

    # 배치 업데이트
    updated = 0
    failed = 0
    for i in range(0, len(pairs), BATCH_SIZE):
        batch = pairs[i:i + BATCH_SIZE]
        ids = [p[0] for p in batch]
        metas = [p[1] for p in batch]
        try:
            coll.update(ids=ids, metadatas=metas)
            updated += len(batch)
        except Exception as e:
            print(f"[metadata-update] 배치 실패 ({i}-{i+len(batch)}): {e}")
            # 개별 재시도
            for doc_id, meta in batch:
                try:
                    coll.update(ids=[doc_id], metadatas=[meta])
                    updated += 1
                except Exception as e2:
                    failed += 1
                    if failed < 10:
                        print(f"  개별 실패 {doc_id}: {e2}")

        if (i // BATCH_SIZE) % 5 == 0:
            print(f"[metadata-update] 진행: {min(i + BATCH_SIZE, len(pairs))}/{len(pairs)} (성공 {updated}, 실패 {failed})")

    print(f"\n[metadata-update] 완료: 갱신 {updated}건, 실패 {failed}건")


if __name__ == "__main__":
    main()
