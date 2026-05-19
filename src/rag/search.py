"""
RAG 2단계: 의미 기반 검색
사용법: python rag/search.py "검색어" [결과수]
예시: python rag/search.py "셀 합치기" 5
"""
import json
import os
import sys

DB_DIR = os.path.join(os.path.dirname(__file__), 'chroma_db')


def search(query, n_results=10):
    """벡터 검색 실행"""
    import chromadb
    from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

    embedding_fn = SentenceTransformerEmbeddingFunction(
        model_name="paraphrase-multilingual-MiniLM-L12-v2"
    )

    client = chromadb.PersistentClient(path=DB_DIR)
    collection = client.get_collection(
        name="tech_support",
        embedding_function=embedding_fn,
    )

    results = collection.query(
        query_texts=[query],
        n_results=n_results,
        include=["documents", "metadatas", "distances"],
    )

    return results


def format_results(results, query):
    """검색 결과 포맷팅"""
    output = []
    output.append(f"검색어: \"{query}\"")
    output.append(f"결과: {len(results['ids'][0])}건\n")

    for i, (doc, meta, dist) in enumerate(zip(
        results['documents'][0],
        results['metadatas'][0],
        results['distances'][0],
    )):
        similarity = max(0, 1 - dist)  # 거리 → 유사도 변환
        output.append(f"{'─' * 70}")
        output.append(f"[{i+1}] {meta.get('title', '제목없음')}")
        output.append(f"    유사도: {similarity:.1%} | 소스: {meta.get('source', '')} | 날짜: {meta.get('date', '')}")
        if meta.get('url'):
            output.append(f"    URL: {meta['url']}")
        output.append(f"\n{doc[:1500]}")
        if len(doc) > 1500:
            output.append("... (생략)")
        output.append("")

    output.append(f"{'─' * 70}")
    return '\n'.join(output)


def main():
    if len(sys.argv) < 2:
        print("사용법: python rag/search.py \"검색어\" [결과수]")
        print("")
        print("예시:")
        print("  python rag/search.py \"gridView 셀 병합\"")
        print("  python rag/search.py \"엑셀 다운로드 느낌표\" 5")
        print("  python rag/search.py \"셀 합치기\"          ← 의미 기반 검색!")
        print("  python rag/search.py \"화면 느려짐\"         ← 키워드 없어도 검색!")
        sys.exit(0)

    query = sys.argv[1]
    n_results = int(sys.argv[2]) if len(sys.argv) > 2 else 10

    results = search(query, n_results)
    print(format_results(results, query))


if __name__ == '__main__':
    main()
