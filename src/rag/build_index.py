"""
RAG 1단계: 벡터 인덱스 구축
13,512건의 기술문의 데이터를 벡터 임베딩으로 변환하여 ChromaDB에 저장
"""
import json
import os
import sys
import time

# 경로 설정
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
DB_DIR = os.path.join(os.path.dirname(__file__), 'chroma_db')

def load_all_data():
    """전체 데이터를 통합 로드"""
    documents = []
    metadatas = []
    ids = []

    print("=== 데이터 로드 ===\n")

    # 1. W-Tech QNA
    qna_path = os.path.join(DATA_DIR, 'wtech', 'qna_data.json')
    with open(qna_path, 'r', encoding='utf-8') as f:
        qna = json.load(f)

    for item in qna:
        answers = '\n'.join([c.get('content', '') for c in item.get('comments', []) if c.get('content', '')])
        doc = f"제목: {item.get('title', '')}\n질문: {item.get('question', '')}\n답변: {answers}"
        documents.append(doc[:3000])  # ChromaDB 제한
        metadatas.append({
            'source': 'wtech_qna',
            'title': item.get('title', '')[:200],
            'date': item.get('date', ''),
            'status': item.get('status', ''),
            'category': 'QNA',
        })
        ids.append(f"qna_{item.get('num', len(ids))}")
    print(f"  W-Tech QNA: {len(qna)}건")

    # 2. Gmail
    email_path = os.path.join(DATA_DIR, 'email', 'email_technical_qna.json')
    with open(email_path, 'r', encoding='utf-8') as f:
        emails = json.load(f)

    for item in emails:
        doc = f"제목: {item.get('subject', '')}\n내용: {item.get('content', '')}"
        documents.append(doc[:3000])
        metadatas.append({
            'source': 'gmail',
            'title': item.get('subject', '')[:200],
            'date': item.get('date', ''),
            'status': '',
            'category': 'Email',
        })
        ids.append(f"email_{item.get('threadId', len(ids))}")
    print(f"  Gmail: {len(emails)}건")

    # 3. Confluence
    conf_files = [
        ('confluence_inside_data.json', 'confluence_inside'),
        ('confluence_db_data.json', 'confluence_db'),
        ('confluence_uxdb_data.json', 'confluence_uxdb'),
        ('confluence_pa_data.json', 'confluence_pa'),
        ('confluence_w5c_data.json', 'confluence_w5c'),
    ]
    for filename, source in conf_files:
        filepath = os.path.join(DATA_DIR, 'confluence', filename)
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        for item in data:
            doc = f"제목: {item.get('title', '')}\n내용: {item.get('content', '')}"
            documents.append(doc[:3000])
            metadatas.append({
                'source': source,
                'title': item.get('title', '')[:200],
                'date': item.get('lastModified', ''),
                'status': '',
                'category': 'Confluence',
                'url': item.get('url', ''),
            })
            ids.append(f"{source}_{item.get('pageId', len(ids))}")
        print(f"  {source}: {len(data)}건")

    # 4. API Guide
    api_path = os.path.join(DATA_DIR, 'api', 'ws5_api_guide.json')
    with open(api_path, 'r', encoding='utf-8') as f:
        api = json.load(f)

    for item in api:
        doc = f"컴포넌트: {item.get('component', '')}\n{item.get('content', '')}"
        documents.append(doc[:3000])
        metadatas.append({
            'source': 'api_guide',
            'title': item.get('title', '')[:200],
            'date': '',
            'status': '',
            'category': 'API',
        })
        ids.append(f"api_{item.get('component', len(ids))}")
    print(f"  API Guide: {len(api)}건")

    # 5. FAQ
    faq_path = os.path.join(DATA_DIR, 'wtech', 'faq_data.json')
    with open(faq_path, 'r', encoding='utf-8') as f:
        faq = json.load(f)

    for item in faq:
        doc = f"질문: {item.get('title', '')}\n답변: {item.get('answer', '')}"
        documents.append(doc[:3000])
        metadatas.append({
            'source': 'wtech_faq',
            'title': item.get('title', '')[:200],
            'date': '',
            'status': '',
            'category': 'FAQ',
        })
        ids.append(f"faq_{item.get('num', len(ids))}")
    print(f"  FAQ: {len(faq)}건")

    print(f"\n총 {len(documents)}건 로드 완료")
    return documents, metadatas, ids


def build_index():
    """ChromaDB 벡터 인덱스 구축"""
    import chromadb
    from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

    # 한국어 지원 다국어 임베딩 모델
    print("\n=== 임베딩 모델 로드 ===")
    print("모델: paraphrase-multilingual-MiniLM-L12-v2 (한국어 지원)")
    embedding_fn = SentenceTransformerEmbeddingFunction(
        model_name="paraphrase-multilingual-MiniLM-L12-v2"
    )

    # ChromaDB 설정
    print(f"\n=== ChromaDB 초기화 ===")
    print(f"저장 경로: {DB_DIR}")

    if os.path.exists(DB_DIR):
        import shutil
        shutil.rmtree(DB_DIR)
        print("기존 DB 삭제")

    client = chromadb.PersistentClient(path=DB_DIR)
    collection = client.create_collection(
        name="tech_support",
        embedding_function=embedding_fn,
        metadata={"description": "WebSquare 기술지원 통합 데이터"}
    )

    # 데이터 로드
    documents, metadatas, ids = load_all_data()

    # 배치로 임베딩 & 저장
    print(f"\n=== 벡터 임베딩 & 저장 ===\n")
    BATCH_SIZE = 100
    total = len(documents)
    start_time = time.time()

    for i in range(0, total, BATCH_SIZE):
        batch_docs = documents[i:i+BATCH_SIZE]
        batch_metas = metadatas[i:i+BATCH_SIZE]
        batch_ids = ids[i:i+BATCH_SIZE]

        # 빈 문서 필터링
        valid = [(d, m, id_) for d, m, id_ in zip(batch_docs, batch_metas, batch_ids) if d.strip()]
        if not valid:
            continue

        docs, metas, id_list = zip(*valid)

        try:
            collection.add(
                documents=list(docs),
                metadatas=list(metas),
                ids=list(id_list),
            )
        except Exception as e:
            print(f"\n  배치 {i//BATCH_SIZE + 1} 오류: {e}")
            # 개별 추가 시도
            for d, m, id_ in zip(docs, metas, id_list):
                try:
                    collection.add(documents=[d], metadatas=[m], ids=[id_])
                except:
                    pass

        elapsed = time.time() - start_time
        progress = min(i + BATCH_SIZE, total)
        pct = progress / total * 100
        speed = progress / elapsed if elapsed > 0 else 0
        eta = (total - progress) / speed if speed > 0 else 0

        print(f"\r  {progress:,}/{total:,} ({pct:.1f}%) | {speed:.0f}건/초 | 남은시간: {eta:.0f}초", end='', flush=True)

    elapsed = time.time() - start_time
    print(f"\n\n=== 완료 ===")
    print(f"인덱싱: {collection.count():,}건")
    print(f"소요시간: {elapsed:.1f}초")
    print(f"DB 경로: {DB_DIR}")


if __name__ == '__main__':
    build_index()
