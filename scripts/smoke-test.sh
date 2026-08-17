#!/usr/bin/env bash
# 当日朝のスモークテスト。**本番と同じ経路**を1コマンドで通す。
#
#   bash scripts/smoke-test.sh <apiUrl> [eventToken]
#   例: bash scripts/smoke-test.sh https://xxx.trycloudflare.com himitsu2026
#
# 通す順序（子どもがやることと同じ）:
#   /health → POST /voices → POST /jobs → GET /jobs（完了まで）
#   → GET /artifacts → POST /render（使えれば）→ /ops
#
# どれかで落ちたら、そこが当日壊れる場所。全部 PASS してから会場を開ける。

set -uo pipefail

API="${1:-}"
TOKEN="${2:-${EVENT_TOKEN:-}}"
if [ -z "$API" ]; then
  echo "使い方: bash scripts/smoke-test.sh <apiUrl> [eventToken]"
  exit 1
fi
API="${API%/}"

PASS=0
FAIL=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

hdr=(-H "X-Event-Token: ${TOKEN}")

ok()   { echo "  ✅ $1"; PASS=$((PASS + 1)); }
ng()   { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
info() { echo "     $1"; }

jsonval() { # jsonval <file> <key>  … jq が無くても動く素朴な取り出し
  sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^,\"}]*\)\"\{0,1\}.*/\1/p" "$1" | head -1
}

echo "== コエコミ スモークテスト"
echo "== API: $API"
echo

# ---- 1. /health --------------------------------------------------------------
echo "--- 1) /health"
if curl -sS -m 15 "$API/health" -o "$TMP/health.json"; then
  STATUS="$(jsonval "$TMP/health.json" status)"
  TTS="$(jsonval "$TMP/health.json" ttsEffective)"
  CAN_RENDER="$(jsonval "$TMP/health.json" canRender)"
  SERVER="$(jsonval "$TMP/health.json" serverId)"
  info "serverId=$SERVER status=$STATUS tts=$TTS canRender=$CAN_RENDER"
  [ "$STATUS" = "ok" ] && ok "起動している" || ng "status=${STATUS}（warming ならモデル読み込み中。少し待つ）"
  [ "$TTS" = "qwen" ] && ok "AI音声が有効" || ng "TTS が ${TTS}（dummy はピー音。ライブラリを確認）"
  [ "$CAN_RENDER" = "true" ] && ok "サーバー側レンダリングが使える" \
    || info "⚠️ canRender=false → 動画はiPad側で書き出し（時間がかかる）"
else
  ng "/health に到達できない。ここから先は無理。トンネルとColabを確認。"
  echo; echo "結果: PASS=$PASS FAIL=$FAIL"; exit 1
fi
echo

# ---- 2. 参照音声を作る（1秒の無音wav）-----------------------------------------
python3 - "$TMP/ref.wav" <<'PY'
import sys, wave
with wave.open(sys.argv[1], "w") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    w.writeframes(b"\x00\x00" * 16000)
PY

echo "--- 2) POST /voices（声を1回だけ預ける）"
if curl -sS -m 60 "${hdr[@]}" -F "audio=@$TMP/ref.wav" -F "reference_text=てすと" \
     "$API/voices" -o "$TMP/voice.json"; then
  VOICE="$(jsonval "$TMP/voice.json" voiceId)"
  if [ -n "$VOICE" ]; then ok "voiceId=$VOICE"; else ng "voiceId が返らない: $(cat "$TMP/voice.json")"; fi
else
  ng "/voices に失敗"
fi
echo

if [ -z "${VOICE:-}" ]; then
  echo "結果: PASS=$PASS FAIL=$FAIL"; exit 1
fi

# ---- 3. ジョブ ---------------------------------------------------------------
echo "--- 3) POST /jobs（2行ぶん生成）"
START=$(date +%s)
curl -sS -m 30 "${hdr[@]}" -H "Content-Type: application/json" \
  -d "{\"voiceId\":\"$VOICE\",\"lines\":[\"こんにちは\",\"またね\"]}" \
  "$API/jobs" -o "$TMP/job.json"
JOB="$(jsonval "$TMP/job.json" jobId)"
if [ -n "$JOB" ]; then ok "jobId=$JOB"; else ng "jobId が返らない: $(cat "$TMP/job.json")"; echo "結果: PASS=$PASS FAIL=$FAIL"; exit 1; fi

echo "--- 4) GET /jobs/${JOB}（完了まで待つ）"
STATE=""
for _ in $(seq 1 120); do
  curl -sS -m 15 "${hdr[@]}" "$API/jobs/$JOB" -o "$TMP/poll.json" || true
  STATE="$(jsonval "$TMP/poll.json" state)"
  [ "$STATE" = "done" ] || [ "$STATE" = "failed" ] || [ "$STATE" = "cancelled" ] && break
  sleep 1
done
ELAPSED=$(( $(date +%s) - START ))
info "state=$STATE / ${ELAPSED}秒"
if [ "$STATE" = "done" ]; then
  ok "生成できた（2行で ${ELAPSED} 秒 → 1行あたり約 $((ELAPSED / 2)) 秒）"
  info "16行の作品なら概ね $((ELAPSED * 8)) 秒。これが子どもの待ち時間の目安。"
else
  ng "state=$STATE: $(cat "$TMP/poll.json")"
fi
echo

# ---- 5. 生成物の取得 ---------------------------------------------------------
ART="$(sed -n 's/.*"artifactId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TMP/poll.json" | head -1)"
echo "--- 5) GET /artifacts/$ART"
if [ -n "$ART" ] && curl -sS -m 30 -f "${hdr[@]}" "$API/artifacts/$ART" -o "$TMP/voice.wav"; then
  SIZE=$(wc -c < "$TMP/voice.wav" | tr -d ' ')
  [ "$SIZE" -gt 1000 ] && ok "音声を取得できた（${SIZE} bytes）" || ng "音声が小さすぎる（${SIZE} bytes）"
else
  ng "生成物を取得できない"
fi
echo

# ---- 6. レンダリング ---------------------------------------------------------
if [ "$CAN_RENDER" = "true" ] && [ -n "$ART" ]; then
  echo "--- 6) POST /render（動画を作る）"
  BODY="{\"segments\":[{\"startMs\":0,\"durMs\":250,\"panelPath\":null,\"subtitle\":\"\",\"artifactId\":null},{\"startMs\":250,\"durMs\":1500,\"panelPath\":null,\"subtitle\":\"てすと\",\"artifactId\":\"$ART\"}]}"
  if curl -sS -m 180 "${hdr[@]}" -H "Content-Type: application/json" -d "$BODY" \
       "$API/render" -o "$TMP/render.json"; then
    VID="$(jsonval "$TMP/render.json" artifactId)"
    if [ -n "$VID" ]; then
      curl -sS -m 60 -f "${hdr[@]}" "$API/artifacts/$VID" -o "$TMP/out.mp4" && \
        ok "動画を作れた（$(wc -c < "$TMP/out.mp4" | tr -d ' ') bytes）" || ng "動画を取得できない"
    else
      ng "レンダリング失敗: $(cat "$TMP/render.json")"
    fi
  else
    ng "/render に失敗"
  fi
  echo
fi

# ---- 7. 認証 -----------------------------------------------------------------
echo "--- 7) 認証（トークン無しで弾かれるか）"
CODE="$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "$API/ops")"
if [ -n "$TOKEN" ]; then
  [ "$CODE" = "401" ] && ok "トークン無しは 401" || ng "トークン無しで $CODE が返る（EVENT_TOKEN 未設定？）"
else
  info "⚠️ トークン未指定で実行中。本番では EVENT_TOKEN を必ず設定すること。"
fi

# 合言葉はフロントのバンドルに載る＝参加者なら誰でも読める。それで「全員分を消す」が
# 通ってしまうと、イベント中に一人の出来心で全滅する。ここで通らないことを確かめる。
# （まだ子どもの作品は入っていない時間帯に走らせる前提。万一 200 なら被害ゼロで検出できる。）
CODE="$(curl -sS -m 15 -o /dev/null -w '%{http_code}' -X POST "${hdr[@]}" "$API/cleanup")"
case "$CODE" in
  401) ok "/cleanup は合言葉では通らない（管理者トークンが要る）" ;;
  503) info "⚠️ ADMIN_TOKEN 未設定。/cleanup は無効（後片付けはランタイム停止で代用）" ;;
  200) ng "/cleanup が合言葉だけで通った。参加者が全員分を消せる。ADMIN_TOKEN を設定すること" ;;
  *)   ng "/cleanup が想定外の $CODE を返す" ;;
esac
echo

# ---- 8. 後片付け -------------------------------------------------------------
curl -sS -m 15 -X DELETE "${hdr[@]}" "$API/voices/$VOICE" -o /dev/null || true
info "テストで使った声は削除しました。"
echo
echo "================================"
echo " PASS=$PASS  FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && echo " ✅ この台は本番で使えます。" || echo " ❌ 上の ❌ を直してから会場を開けてください。"
echo "================================"
[ "$FAIL" -eq 0 ]
