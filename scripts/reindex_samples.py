#!/usr/bin/env python3
"""개발가이드 샘플(559건)만 chroma에 재반영(upsert).

doc_id가 question+answer 해시 기반이라 첨부(attachments)는 메타데이터만 바뀌어
증분 인덱싱(npm run index)으로는 갱신되지 않는다. 같은 ID로 upsert하면
메타데이터(attachments/attachmentDir)가 갱신된다. 전체 reset보다 훨씬 가볍다.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src" / "rag"))
from indexer import RAGIndexer  # noqa: E402

ALL_QA = Path(__file__).parent.parent / "data" / "processed" / "all_qa.json"

def main():
    data = json.loads(ALL_QA.read_text(encoding="utf-8"))
    samples = [x for x in data if x.get("source") == "개발가이드 샘플"]
    print(f"[reindex_samples] 대상 샘플: {len(samples)}건")

    idx = RAGIndexer()
    idx.init_collection(reset=False)
    before = idx.collection.count()

    total = len(samples)
    ok = 0
    BATCH = 256
    for i in range(0, total, BATCH):
        batch = samples[i:i + BATCH]
        ok += idx._index_batch(batch)
        print(f"[reindex_samples] {min(i + BATCH, total)}/{total} (upsert 성공 {ok})")

    after = idx.collection.count()
    print(f"[reindex_samples] 완료: {ok}건 upsert | 컬렉션 {before} → {after}")

if __name__ == "__main__":
    main()
