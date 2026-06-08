#!/bin/bash
#
# watchdog.sh — AI 답변 운영 서버 감시 + Discord 알림 + 자동 재기동
#
# cron 5분 주기 권장:
#   */5 * * * * /var/www/html/ser-pr5/ai-answer-codex/scripts/watchdog.sh >> /var/www/html/ser-pr5/ai-answer-codex/logs/watchdog.log 2>&1
#
# 설정: 같은 폴더의 watchdog.conf 에 WEBHOOK 등을 넣는다 (시크릿이라 분리).
#   WEBHOOK="https://discord.com/api/webhooks/xxx/yyy"
#   PORT=3000            # (선택) 기본 3000
#   HEALTH_PATH=/api/health
#
set -u

# ── 경로/설정 ────────────────────────────────────────────────
DIR="$(cd "$(dirname "$0")/.." && pwd)"          # ai-answer-codex 루트
CONF="$(dirname "$0")/watchdog.conf"
STATE_DIR="$DIR/logs"
HEALTH_STATE="$STATE_DIR/watchdog.health"        # 직전 health 상태(up/down) — 알림 중복 방지
ERR_OFFSET="$STATE_DIR/watchdog.erroffset"       # err.log 마지막 스캔 위치(byte)
ERR_LOG="$DIR/server.err.log"

PORT=3000
HEALTH_PATH="/api/health"
WEBHOOK=""
START_CMD=""   # 비우면 기본 nohup 명령 사용 (아래 restart 참고). start.sh 등 쓰려면 conf에서 지정.
[ -f "$CONF" ] && . "$CONF"

mkdir -p "$STATE_DIR"

# ── Discord 알림 ─────────────────────────────────────────────
notify() {
  local msg="$1"
  echo "[$(date '+%F %T')] $msg"
  [ -z "$WEBHOOK" ] && { echo "  (WEBHOOK 미설정 — 알림 생략)"; return; }
  # JSON 이스케이프(따옴표/역슬래시/개행)
  local esc
  esc=$(printf '%s' "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
  curl -s -m 10 -H "Content-Type: application/json" \
       -d "{\"content\":\"$esc\"}" "$WEBHOOK" >/dev/null
}

HOST="$(hostname)"
prefix="**[AI답변 $HOST]**"

# ── 1) Health 체크 (+ 자동 재기동) ───────────────────────────
prev_health="up"
[ -f "$HEALTH_STATE" ] && prev_health="$(cat "$HEALTH_STATE")"

if curl -sf -m 10 "http://localhost:${PORT}${HEALTH_PATH}" >/dev/null 2>&1; then
  # 정상. 직전이 down이었다면 복구 알림.
  if [ "$prev_health" = "down" ]; then
    notify "$prefix 🟢 서버 정상 복구됨"
  fi
  echo "up" > "$HEALTH_STATE"
else
  # 다운 감지 → 자동 재기동
  notify "$prefix 🔴 서버 DOWN 감지 — 자동 재기동 시도"

  # 혹시 떠 있는데 hang 상태면 먼저 정리
  pids=$(pgrep -f "node src/api/server.js" || true)
  if [ -n "$pids" ]; then
    kill -TERM $pids 2>/dev/null
    sleep 3
    pgrep -f "node src/api/server.js" >/dev/null && kill -KILL $pids 2>/dev/null
  fi

  # 재기동: conf에 START_CMD가 있으면 그걸, 없으면 기본 nohup으로 백그라운드 기동.
  # (포그라운드로 띄우면 cron 워치독이 멈춰 health 재확인이 안 돌아오므로 반드시 백그라운드)
  if [ -n "$START_CMD" ]; then
    ( cd "$DIR" && eval "$START_CMD" ) >/dev/null 2>&1
  else
    ( cd "$DIR" && PORT="$PORT" nohup node src/api/server.js >> "$DIR/server.log" 2>> "$ERR_LOG" & ) >/dev/null 2>&1
  fi
  sleep 5

  if curl -sf -m 10 "http://localhost:${PORT}${HEALTH_PATH}" >/dev/null 2>&1; then
    notify "$prefix 🟢 자동 재기동 성공"
    echo "up" > "$HEALTH_STATE"
  else
    notify "$prefix ❌ 자동 재기동 실패 — 수동 확인 필요 (server.err.log 확인)"
    echo "down" > "$HEALTH_STATE"
  fi
fi

# ── 2) Codex 실패(연결 끊김/용량 소진) 스캔 ──────────────────
# server.err.log 의 "새로 추가된 줄"만 검사한다.
if [ -f "$ERR_LOG" ]; then
  cur_size=$(wc -c < "$ERR_LOG" | tr -d ' ')
  # 첫 실행(오프셋 파일 없음): 과거 로그 전체를 알림으로 쏘지 않도록
  # 현재 위치만 기록하고 이번 스캔은 건너뛴다.
  if [ ! -f "$ERR_OFFSET" ]; then
    echo "$cur_size" > "$ERR_OFFSET"
    exit 0
  fi
  last_size="$(cat "$ERR_OFFSET")"
  # 로그 로테이트(파일이 줄어듦) 시 처음부터
  [ "$cur_size" -lt "$last_size" ] && last_size=0

  if [ "$cur_size" -gt "$last_size" ]; then
    new_lines=$(tail -c +"$((last_size + 1))" "$ERR_LOG")
    # Codex/용량/인증/한도 관련 신호
    hits=$(printf '%s\n' "$new_lines" | grep -iE \
      'codex exec exit|codex exec timeout|rate.?limit|usage limit|quota|insufficient|unauthorized|401|429|forbidden|expired|login' \
      | head -5)
    if [ -n "$hits" ]; then
      notify "$prefix ⚠️ Codex/LLM 호출 이상 감지 (server.err.log)\n\`\`\`\n$(printf '%s' "$hits" | head -c 1500)\n\`\`\`"
    fi
  fi
  echo "$cur_size" > "$ERR_OFFSET"
fi

exit 0
