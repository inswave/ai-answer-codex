"""
RAG 하이브리드 검색 모듈
벡터 검색 (코사인 유사도) + BM25 키워드 검색 결합
"""

import json
import re
import sys
import io
from pathlib import Path

# Windows cp949 인코딩 에러 방지
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import chromadb
from sentence_transformers import SentenceTransformer
from rank_bm25 import BM25Okapi

try:
    from .preprocessor import preprocess_query
except ImportError:
    from preprocessor import preprocess_query

EMBEDDING_MODEL = "intfloat/multilingual-e5-base"
COLLECTION_NAME = "techassistant_qa"
CHROMA_DIR = str(Path(__file__).parent.parent.parent / "data" / "chroma")
TOP_K = 8
MAX_CONTEXT_LENGTH = 2000

# 하이브리드 검색 가중치 (벡터 : BM25)
VECTOR_WEIGHT = 0.6
BM25_WEIGHT = 0.4


def tokenize(text):
    """
    간이 한국어+영어 토크나이저
    - 영어 camelCase 분리: getCellData → get, Cell, Data
    - 한글 2자 이상 단어 추출
    - 소문자 정규화
    """
    tokens = []

    # camelCase 분리
    text = re.sub(r'([a-z])([A-Z])', r'\1 \2', text)

    # 영어 단어
    eng_tokens = re.findall(r'[a-zA-Z]{2,}', text)
    tokens.extend([t.lower() for t in eng_tokens])

    # 한글 단어
    kor_tokens = re.findall(r'[가-힣]{2,}', text)
    tokens.extend(kor_tokens)

    # 숫자 포함 식별자 (예: SP4, v5.0)
    id_tokens = re.findall(r'[a-zA-Z]+\d+[\w.]*', text)
    tokens.extend([t.lower() for t in id_tokens])

    return tokens


class RAGSearcher:
    def __init__(self, chroma_dir=None):
        self.chroma_dir = chroma_dir or CHROMA_DIR
        self.model = SentenceTransformer(EMBEDDING_MODEL)
        self.client = chromadb.PersistentClient(path=self.chroma_dir)
        self.collection = self.client.get_collection(name=COLLECTION_NAME)

        # BM25 인덱스 초기화
        self._bm25 = None
        self._bm25_docs = None
        self._bm25_ids = None

        print(f"[RAG Search] 컬렉션 로드: {self.collection.count()}건")

    def _init_bm25(self):
        """BM25 인덱스를 lazy 로딩으로 초기화"""
        if self._bm25 is not None:
            return

        print("[RAG Search] BM25 인덱스 구축 중...")
        # 전체 문서를 ChromaDB에서 가져오기
        total = self.collection.count()
        all_docs = []
        all_ids = []

        # ChromaDB는 한번에 가져올 수 있는 양이 제한되므로 배치로
        batch_size = 5000
        for offset in range(0, total, batch_size):
            limit = min(batch_size, total - offset)
            batch = self.collection.get(
                limit=limit,
                offset=offset,
                include=["documents"],
            )
            all_docs.extend(batch["documents"])
            all_ids.extend(batch["ids"])

        # 토큰화
        tokenized = [tokenize(doc) for doc in all_docs]
        self._bm25 = BM25Okapi(tokenized)
        self._bm25_docs = all_docs
        self._bm25_ids = all_ids
        print(f"[RAG Search] BM25 인덱스 구축 완료: {len(all_docs)}건")

    def _search_vector(self, query, top_k, category_filter=None):
        """벡터 검색 (코사인 유사도)"""
        cleaned_query = preprocess_query(query)
        query_embedding = self.model.encode([f"query: {cleaned_query}"]).tolist()

        where_filter = None
        if category_filter:
            where_filter = {"category": category_filter}

        results = self.collection.query(
            query_embeddings=query_embedding,
            n_results=top_k,
            where=where_filter,
            include=["documents", "metadatas", "distances"],
        )

        scored = {}
        if results and results["documents"]:
            for doc, meta, dist, doc_id in zip(
                results["documents"][0],
                results["metadatas"][0],
                results["distances"][0],
                results["ids"][0],
            ):
                score = 1 - dist  # 코사인 유사도 (0~1)
                scored[doc_id] = {
                    "document": doc,
                    "metadata": meta,
                    "vector_score": round(score, 4),
                }
        return scored

    def _search_bm25(self, query, top_k):
        """BM25 키워드 검색"""
        self._init_bm25()

        query_tokens = tokenize(query)
        if not query_tokens:
            return {}

        scores = self._bm25.get_scores(query_tokens)

        # 상위 top_k 인덱스
        top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]

        # 점수 정규화 (0~1)
        max_score = max(scores) if max(scores) > 0 else 1

        scored = {}
        for idx in top_indices:
            if scores[idx] <= 0:
                continue
            doc_id = self._bm25_ids[idx]
            scored[doc_id] = {
                "bm25_score": round(scores[idx] / max_score, 4),
            }
        return scored

    def search(self, query, top_k=None, category_filter=None):
        """
        하이브리드 검색 (벡터 + BM25)

        Args:
            query: 검색 쿼리
            top_k: 반환 결과 수 (기본 8)
            category_filter: 카테고리 필터

        Returns:
            list[dict]: 검색 결과 [{document, metadata, distance, score}, ...]
        """
        top_k = top_k or TOP_K

        # 벡터/BM25 각각 넉넉하게 가져와서 결합
        fetch_k = top_k * 3

        vector_results = self._search_vector(query, fetch_k, category_filter)
        bm25_results = self._search_bm25(query, fetch_k)

        # 점수 결합 (Reciprocal Rank Fusion 방식)
        combined = {}

        for doc_id, data in vector_results.items():
            combined[doc_id] = {
                "document": data["document"],
                "metadata": data["metadata"],
                "vector_score": data["vector_score"],
                "bm25_score": 0.0,
            }

        for doc_id, data in bm25_results.items():
            if doc_id in combined:
                combined[doc_id]["bm25_score"] = data["bm25_score"]
            else:
                # BM25에만 있는 결과 → ChromaDB에서 문서 가져오기
                try:
                    doc_data = self.collection.get(ids=[doc_id], include=["documents", "metadatas"])
                    if doc_data["documents"]:
                        combined[doc_id] = {
                            "document": doc_data["documents"][0],
                            "metadata": doc_data["metadatas"][0],
                            "vector_score": 0.0,
                            "bm25_score": data["bm25_score"],
                        }
                except Exception:
                    pass

        # 최종 점수 계산 (가중 합산)
        for doc_id, data in combined.items():
            data["final_score"] = round(
                VECTOR_WEIGHT * data["vector_score"] + BM25_WEIGHT * data["bm25_score"],
                4,
            )

        # 정렬 후 상위 top_k
        sorted_results = sorted(combined.items(), key=lambda x: x[1]["final_score"], reverse=True)[:top_k]

        search_results = []
        for rank, (doc_id, data) in enumerate(sorted_results):
            search_results.append({
                "rank": rank + 1,
                "document": data["document"][:MAX_CONTEXT_LENGTH],
                "metadata": data["metadata"],
                "distance": round(1 - data["final_score"], 4),
                "score": data["final_score"],
                "vector_score": data["vector_score"],
                "bm25_score": data["bm25_score"],
            })

        return search_results

    def build_context(self, results):
        """검색 결과를 Claude API 컨텍스트 형태로 구성"""
        if not results:
            return "관련 사례를 찾지 못했습니다."

        context_parts = []
        for r in results:
            meta = r["metadata"]
            source_info = f"[출처: {meta.get('source', '알 수 없음')} | 분류: {meta.get('category', '')} > {meta.get('subcategory', '')} | 유사도: {r['score']:.2f}]"
            context_parts.append(f"--- 참고 사례 #{r['rank']} {source_info} ---\n{r['document']}")

        return "\n\n".join(context_parts)

    def search_with_context(self, query, top_k=None, category_filter=None):
        """검색 + 컨텍스트 빌드를 한번에 수행"""
        results = self.search(query, top_k, category_filter)
        context = self.build_context(results)

        return {
            "query": query,
            "results": results,
            "context": context,
            "result_count": len(results),
        }


def main():
    """CLI 검색 테스트"""
    import argparse

    parser = argparse.ArgumentParser(description="RAG 하이브리드 검색")
    parser.add_argument("query", help="검색 쿼리")
    parser.add_argument("--top-k", type=int, default=TOP_K, help="검색 결과 수")
    parser.add_argument("--category", default=None, help="카테고리 필터")
    args = parser.parse_args()

    searcher = RAGSearcher()
    result = searcher.search_with_context(args.query, args.top_k, args.category)

    print(f"\n검색 쿼리: {result['query']}")
    print(f"검색 결과: {result['result_count']}건\n")

    for r in result["results"]:
        v = r.get("vector_score", 0)
        b = r.get("bm25_score", 0)
        meta = r["metadata"]
        print(f"#{r['rank']} [최종: {r['score']:.4f} | 벡터: {v:.4f} | BM25: {b:.4f}] {meta.get('source', '')}")
        print(f"  질문: {meta.get('question', '')[:100]}")
        url = meta.get("url", "")
        if url:
            print(f"  URL: {url}")
        attachment_dir = meta.get("attachmentDir", "")
        if attachment_dir:
            print(f"  AttachmentDir: {attachment_dir}")
        attachments_json = meta.get("attachments", "")
        if attachments_json:
            print(f"  Attachments: {attachments_json}")
        doc = r.get("document", "")
        if doc:
            print(f"  답변: {doc[:500]}")
        print()


if __name__ == "__main__":
    main()
