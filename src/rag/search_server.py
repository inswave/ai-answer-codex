"""
RAG 상주 검색 서버 (방안2)

임베딩 모델(e5-base) + ChromaDB + BM25 인덱스를 프로세스 시작 시 1회만 메모리에 로딩하고,
이후 검색 요청은 메모리에 상주한 모델로 즉시 처리한다.
기존처럼 질문마다 Python을 새로 띄워 모델을 콜드로딩하던 ~18초 비용을 제거한다.

- 표준 라이브러리(http.server)만 사용 → 추가 pip 설치 없음
- 127.0.0.1 로컬 바인딩 (외부 노출 안 함)
- 출력은 searcher.render_cli_output 으로 CLI와 동일 포맷 → Node 파서(parseRagResults) 무수정
- 서버가 죽어도 Node 쪽에서 기존 subprocess 방식으로 자동 폴백
"""

import os
import sys
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    from .searcher import RAGSearcher, render_cli_output, TOP_K
except ImportError:
    from searcher import RAGSearcher, render_cli_output, TOP_K

HOST = os.environ.get("RAG_SERVER_HOST", "127.0.0.1")
PORT = int(os.environ.get("RAG_SERVER_PORT", "8765"))

_searcher = None
_lock = threading.Lock()


def get_searcher():
    global _searcher
    # 더블체크 락 — 비정상 시퀀스(워밍업 전 동시요청)에서도 단일 인스턴스 보장
    if _searcher is None:
        with _lock:
            if _searcher is None:
                _searcher = RAGSearcher()
    return _searcher


class Handler(BaseHTTPRequestHandler):
    # 비정상 클라이언트(Content-Length 과대 설정 등)로 인한 스레드 무한대기 방지
    timeout = 30
    MAX_BODY_BYTES = 1 * 1024 * 1024  # 1MB
    def _send(self, code, body, content_type="text/plain; charset=utf-8"):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/health"):
            ready = _searcher is not None
            self._send(200 if ready else 503, "ok" if ready else "loading")
        else:
            self._send(404, "not found")

    def do_POST(self):
        if not self.path.startswith("/search"):
            self._send(404, "not found")
            return
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length > self.MAX_BODY_BYTES:
                self._send(413, "payload too large")
                return
            raw = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw.decode("utf-8") or "{}")
            query = (payload.get("query") or "").strip()
            top_k = int(payload.get("topK") or payload.get("top_k") or TOP_K)
            top_k = max(1, min(top_k, 50))  # 비정상 값 클램핑
            category = payload.get("category") or None
            if not query:
                self._send(400, "missing query")
                return
            # 모델/인덱스 접근은 직렬화 (스레드 안전 보장)
            with _lock:
                searcher = get_searcher()
                result = searcher.search_with_context(query, top_k, category)
            self._send(200, render_cli_output(result))
        except Exception as e:  # noqa: BLE001 - 어떤 오류든 500으로 응답해 서버 유지
            print(f"[RAG Server] ERROR: {e}", file=sys.stderr, flush=True)
            self._send(500, f"error: {e}")

    def log_message(self, *args):
        # 기본 접근 로그 비활성 (rag_server.out.log 가독성)
        pass


def main():
    print(f"[RAG Server] starting on {HOST}:{PORT} ...", flush=True)
    # 소켓을 열기 전에 모델/인덱스를 모두 로딩 → 포트가 열렸다는 것은 곧 '준비 완료'를 의미.
    # 모델/인덱스 로딩 실패 시 명시적으로 종료해 무음 장애를 막는다(Node는 subprocess로 폴백).
    try:
        get_searcher()
    except Exception as e:  # noqa: BLE001
        import traceback
        print(f"[RAG Server] FATAL: 모델/인덱스 로딩 실패: {e}", file=sys.stderr, flush=True)
        traceback.print_exc()
        sys.exit(1)
    try:
        # BM25는 첫 검색 때 lazy 빌드되므로, 워밍업 1회로 미리 구축
        get_searcher().search_with_context("websquare", TOP_K, None)
        print("[RAG Server] warmup done", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[RAG Server] warmup skipped: {e}", flush=True)

    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[RAG Server] ready on {HOST}:{PORT}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
