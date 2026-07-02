#!/bin/bash
# [운영] account2 신규분 증분 인덱싱 + RAG 상주 서버 재시작
#
# 전제: 로컬에서 prepare_account2_for_index.js 로 만든
#       data/processed/account2_classified.json 을 운영서버 같은 경로로 옮겨둔 상태.
#
# 핵심 안전원칙:
#   - indexer.py 를 --reset 없이(증분) 실행한다. 기존 16,146건은 그대로 두고
#     신규 해시만 추가된다. (절대 --reset 쓰지 말 것: 16,146 → 979 파괴)
#   - merge.js 는 운영에서 돌리지 않는다. (raw 부족으로 all_qa.json 파괴됨)
#
# 사용법 (MobaXterm 등에서 한 줄씩 붙여넣기 가능):
#   cd /var/www/html/ser-pr5/ai-answer-codex
#   export PYTHON_PATH=<chromadb 깔린 python3 경로>   # 아래 0단계로 찾기
#   bash scripts/index_account2_on_prod.sh

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PYTHON_PATH="${PYTHON_PATH:-python3}"
RAG_SERVER_PORT="${RAG_SERVER_PORT:-8765}"
# 인덱싱할 데이터 파일: 1번 인자로 지정, 없으면 통합 배치 파일 기본값
DATA_FILE="${1:-data/processed/index_batch_classified.json}"

echo "=== [0] 사전 점검 ==="
if [ ! -f "$DATA_FILE" ]; then
  echo "[중단] $DATA_FILE 없음. 로컬에서 만들어 옮겨오세요."; exit 1
fi
echo "python: $PYTHON_PATH"
"$PYTHON_PATH" -c "import chromadb; print('chromadb OK', chromadb.__version__)" || {
  echo "[중단] 이 python 에 chromadb 가 없습니다."
  echo "       상주 RAG 서버가 쓰는 python 을 찾으세요:"
  echo "         ps aux | grep '[s]earch_server.py'"
  echo "       그 경로를 PYTHON_PATH 로 지정 후 다시 실행하세요."
  exit 1
}

echo "=== [1] 인덱싱 전 건수 ==="
"$PYTHON_PATH" - <<PY
import sqlite3
db=sqlite3.connect('data/chroma/chroma.sqlite3'); cur=db.cursor()
cur.execute("SELECT c.name, COUNT(*) FROM embeddings e JOIN segments s ON e.segment_id=s.id JOIN collections c ON s.collection=c.id WHERE c.name='techassistant_qa' GROUP BY c.name")
for n,cnt in cur.fetchall(): print('  before:', n, cnt)
PY

echo "=== [2] 백업 (안전) ==="
cp -a data/chroma "data/chroma.bak.$(date +%Y%m%d_%H%M%S)"
echo "  백업 완료"

echo "=== [3] 증분 인덱싱 (--reset 없음!) ==="
"$PYTHON_PATH" src/rag/indexer.py --data "$DATA_FILE"

echo "=== [4] 인덱싱 후 건수 ==="
"$PYTHON_PATH" - <<PY
import sqlite3
db=sqlite3.connect('data/chroma/chroma.sqlite3'); cur=db.cursor()
cur.execute("SELECT c.name, COUNT(*) FROM embeddings e JOIN segments s ON e.segment_id=s.id JOIN collections c ON s.collection=c.id WHERE c.name='techassistant_qa' GROUP BY c.name")
for n,cnt in cur.fetchall(): print('  after:', n, cnt)
PY

echo "=== [5] RAG 상주 서버 재시작 (새 인덱스 메모리 반영) ==="
# bracket 트릭([s]rc): pkill 가 자기 자신을 잡지 않도록
pkill -f "[s]rc/rag/search_server.py" || true
sleep 1
RAG_SERVER_PORT="$RAG_SERVER_PORT" nohup "$PYTHON_PATH" src/rag/search_server.py > rag_server.out.log 2> rag_server.err.log &
sleep 2

echo "=== [6] 재시작 확인 ==="
if "$PYTHON_PATH" -c "import socket,sys; s=socket.socket(); s.settimeout(2); sys.exit(0 if s.connect_ex(('127.0.0.1',$RAG_SERVER_PORT))==0 else 1)"; then
  echo "  RAG 서버 정상 (포트 $RAG_SERVER_PORT)"
else
  echo "  WARNING: 포트 응답 없음 — rag_server.err.log 확인. (Node 가 subprocess 폴백으로 동작은 함)"
fi

echo "=== 완료. before/after 건수 차이가 account2 신규 반영분입니다. ==="
echo "문제 시 롤백: 위 data/chroma.bak.* 를 data/chroma 로 복원 후 RAG 재시작"
