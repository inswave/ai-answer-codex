"""
RAG 벡터 인덱싱 모듈
ChromaDB + multilingual-e5-base (768차원)
100건 단위 배치 처리, 개별 재시도 로직, 텍스트 전처리 적용
"""

import hashlib
import json
import os
import sys
from pathlib import Path

import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer

try:
    from .preprocessor import make_clean_document, extract_metadata
except ImportError:
    from preprocessor import make_clean_document, extract_metadata

# 설정
EMBEDDING_MODEL = "intfloat/multilingual-e5-base"
COLLECTION_NAME = "techassistant_qa"
BATCH_SIZE = 256  # 큰 배치로 임베딩 throughput 향상
CHROMA_DIR = str(Path(__file__).parent.parent.parent / "data" / "chroma")
PROCESSED_DIR = str(Path(__file__).parent.parent.parent / "data" / "processed")


class RAGIndexer:
    def __init__(self, chroma_dir=None):
        self.chroma_dir = chroma_dir or CHROMA_DIR
        self.model = SentenceTransformer(EMBEDDING_MODEL)
        self.client = chromadb.PersistentClient(path=self.chroma_dir)
        self.collection = None
        print(f"[RAG Indexer] 임베딩 모델: {EMBEDDING_MODEL} (768차원)")
        print(f"[RAG Indexer] ChromaDB 경로: {self.chroma_dir}")

    def init_collection(self, reset=False):
        """컬렉션 초기화"""
        if reset:
            try:
                self.client.delete_collection(COLLECTION_NAME)
                print("[RAG Indexer] 기존 컬렉션 삭제")
            except Exception:
                pass

        self.collection = self.client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
        print(f"[RAG Indexer] 컬렉션 '{COLLECTION_NAME}' 준비 완료 (기존 {self.collection.count()}건)")

    def load_data(self, data_path=None):
        """분류 완료된 Q&A 데이터 로드"""
        data_path = data_path or os.path.join(PROCESSED_DIR, "classified_qa.json")
        with open(data_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        print(f"[RAG Indexer] 데이터 로드: {len(data)}건")
        return data

    def _make_doc_id(self, item):
        """내용 기반 고유 ID 생성 (해시)"""
        key = (item.get("question", "") + "|" + item.get("answer", "")[:200]).encode("utf-8")
        return "doc_" + hashlib.md5(key).hexdigest()[:12]

    def index(self, data, reset=False):
        """증분 인덱싱 — 신규 데이터만 임베딩 (reset=True면 전체 재인덱싱)"""
        self.init_collection(reset=reset)

        # 기존 ID 조회하여 신규분만 필터링
        if not reset:
            existing_ids = set(self.collection.get()["ids"]) if self.collection.count() > 0 else set()
            new_data = []
            for item in data:
                if self._make_doc_id(item) not in existing_ids:
                    new_data.append(item)
            skipped = len(data) - len(new_data)
            print(f"[RAG Indexer] 기존 {skipped}건 스킵, 신규 {len(new_data)}건 인덱싱")
            if len(new_data) == 0:
                print("[RAG Indexer] 신규 데이터 없음. 인덱싱 완료.")
                print(f"[RAG Indexer] 컬렉션 총 문서 수: {self.collection.count()}")
                return
            data = new_data

        total = len(data)
        indexed = 0
        failed = 0

        for i in range(0, total, BATCH_SIZE):
            batch = data[i : i + BATCH_SIZE]
            batch_success = self._index_batch(batch)
            indexed += batch_success
            failed += len(batch) - batch_success
            print(f"[RAG Indexer] 진행: {min(i + BATCH_SIZE, total)}/{total} (성공: {indexed}, 실패: {failed})")

        print(f"\n[RAG Indexer] 인덱싱 완료: {indexed}건 성공, {failed}건 실패")
        print(f"[RAG Indexer] 컬렉션 총 문서 수: {self.collection.count()}")

    def _index_batch(self, batch):
        """배치 인덱싱 (개별 재시도 로직)"""
        documents = []
        metadatas = []
        ids = []

        for item in batch:
            doc_text = make_clean_document(item)
            if not doc_text.strip():
                continue

            doc_id = self._make_doc_id(item)
            metadata = extract_metadata(item)

            documents.append(doc_text)
            metadatas.append(metadata)
            ids.append(doc_id)

        if not documents:
            return 0

        # 배치 임베딩 (e5 모델은 "passage: " prefix 필요)
        try:
            prefixed_docs = [f"passage: {doc}" for doc in documents]
            embeddings = self.model.encode(prefixed_docs, show_progress_bar=False).tolist()
            self.collection.upsert(
                ids=ids,
                embeddings=embeddings,
                documents=documents,
                metadatas=metadatas,
            )
            return len(documents)
        except Exception as e:
            print(f"[RAG Indexer] 배치 실패, 개별 재시도: {e}")
            return self._index_individually(documents, metadatas, ids)

    def _index_individually(self, documents, metadatas, ids):
        """개별 재시도"""
        success = 0
        for doc, meta, doc_id in zip(documents, metadatas, ids):
            try:
                embedding = self.model.encode([f"passage: {doc}"], show_progress_bar=False).tolist()
                self.collection.upsert(
                    ids=[doc_id],
                    embeddings=embedding,
                    documents=[doc],
                    metadatas=[meta],
                )
                success += 1
            except Exception as e:
                print(f"[RAG Indexer] 개별 인덱싱 실패 ({doc_id}): {e}")
        return success

def main():
    """CLI 실행"""
    import argparse

    parser = argparse.ArgumentParser(description="RAG 벡터 인덱싱")
    parser.add_argument("--data", default=None, help="입력 데이터 경로")
    parser.add_argument("--reset", action="store_true", help="컬렉션 초기화 후 재인덱싱")
    args = parser.parse_args()

    indexer = RAGIndexer()
    data = indexer.load_data(args.data)
    indexer.index(data, reset=args.reset)


if __name__ == "__main__":
    main()
