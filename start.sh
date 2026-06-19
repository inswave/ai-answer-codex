#!/bin/bash
cd "$(dirname "$0")"
export PATH=/var/www/html/ser-pr5/ai-answer-codex/.conda-envs/rag/bin:$PATH
export PYTHON_PATH=/var/www/html/ser-pr5/ai-answer-codex/.conda-envs/rag/bin/python
export DISABLE_PUPPETEER=1
export RAG_SERVER_PORT=8765

# 1) RAG 상주 검색 서버 (임베딩 모델/인덱스를 1회만 메모리 로딩)
nohup "$PYTHON_PATH" src/rag/search_server.py > rag_server.out.log 2> rag_server.err.log &
echo "rag server started: PID $!"

# 2) RAG 서버 준비 대기 (모델 로딩+워밍업 ~20초). 포트가 열리면 준비 완료. 최대 120초.
RAG_READY=0
for i in $(seq 1 120); do
  if "$PYTHON_PATH" -c "import socket,sys; s=socket.socket(); s.settimeout(1); sys.exit(0 if s.connect_ex(('127.0.0.1',8765))==0 else 1)" 2>/dev/null; then
    echo "rag server ready (port 8765 open)"
    RAG_READY=1
    break
  fi
  sleep 1
done
if [ "$RAG_READY" != "1" ]; then
  echo "WARNING: RAG 서버가 120초 내 준비되지 않음. Node는 subprocess 폴백으로 동작합니다. rag_server.err.log 확인 필요."
fi

# 3) Node API 서버 (RAG 서버가 아직 안 떴어도 자동 폴백되므로 안전)
nohup node src/api/server.js > server.out.log 2> server.err.log &
echo "started: PID $!"
