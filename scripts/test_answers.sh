#!/usr/bin/env bash
# 10개 문의 답변 생성 테스트 — /api/answer 엔드포인트
set -u
API="http://localhost:3000/api/answer"
OUT="/tmp/answer_test_results.json"

queries=(
  "gridView에서 엑셀 다운로드 시 한글이 깨지는 현상 해결 방법"
  "submission으로 서버에 데이터를 전송하는 방법 알려주세요"
  "날짜 입력 컴포넌트의 표시 포맷을 yyyy-MM-dd로 변경하려면"
  "팝업 창에서 부모 창으로 데이터를 전달하는 방법"
  "gridView 특정 행의 배경색을 조건에 따라 변경하고 싶습니다"
  "selectbox에 dataList를 동적으로 바인딩하는 방법"
  "파일 업로드 컴포넌트로 다중 파일을 업로드하는 방법"
  "WebSquare 5.0에서 6.0으로 업그레이드 시 호환성 주의사항"
  "차트 컴포넌트의 데이터를 갱신하면 화면이 다시 그려지지 않습니다"
  "input 컴포넌트에 숫자만 입력되도록 제한하는 방법"
)

echo "[" > "$OUT"
n=${#queries[@]}
for i in "${!queries[@]}"; do
  q="${queries[$i]}"
  idx=$((i+1))
  echo ">>> [$idx/$n] $q"
  start=$(date +%s)
  resp=$(curl -s -X POST "$API" -H 'Content-Type: application/json' \
    -d "$(printf '{"query":%s}' "$(printf '%s' "$q" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")" \
    --max-time 280)
  end=$(date +%s)
  elapsed=$((end-start))
  # 답변 요약 출력
  echo "$resp" | python3 -c '
import json,sys
try:
    d=json.load(sys.stdin)
    ans=d.get("answer","") or ""
    print("    answer len={} confidence={} mode={} risk={} review={} sources={}".format(
        len(ans), d.get("confidence"), d.get("answerMode"), d.get("riskLevel"),
        d.get("needsHumanReview"), len(d.get("sources",[]))))
    if d.get("error"): print("    ERROR:", d.get("error"))
except Exception as e:
    print("    PARSE FAIL:", e, sys.stdin.read()[:200])
'
  echo "    elapsed=${elapsed}s"
  # 결과 JSON 누적
  python3 -c '
import json,sys
q=sys.argv[1]; elapsed=int(sys.argv[2]); idx=int(sys.argv[3])
try:
    d=json.loads(sys.argv[4])
except Exception:
    d={"error":"parse fail","raw":sys.argv[4][:300]}
ans=d.get("answer","") or ""
rec={"idx":idx,"query":q,"elapsed":elapsed,"answerLen":len(ans),
     "confidence":d.get("confidence"),"answerMode":d.get("answerMode"),
     "riskLevel":d.get("riskLevel"),"needsHumanReview":d.get("needsHumanReview"),
     "sourceCount":len(d.get("sources",[])),"error":d.get("error"),
     "ok": bool(ans) and not d.get("error")}
print(json.dumps(rec,ensure_ascii=False))
' "$q" "$elapsed" "$idx" "$resp" >> "$OUT"
  [ "$idx" -lt "$n" ] && echo "," >> "$OUT"
done
echo "]" >> "$OUT"
echo ">>> 완료. 결과: $OUT"
