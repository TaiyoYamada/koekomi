#!/usr/bin/env bash
# GAS（サーバー名簿）の動作確認。
#
#   bash scripts/test-gas.sh "https://script.google.com/macros/s/XXXX/exec"
#
# register → list → heartbeat → list を叩く。
# assign / release / presence は廃止した（負荷分散をやめたため）。

set -euo pipefail

GAS_URL="${1:-}"
if [ -z "$GAS_URL" ]; then
  echo "使い方: bash scripts/test-gas.sh <GAS_URLの/exec>"
  exit 1
fi

SID="test-$(date +%s)"
echo "== GAS_URL: $GAS_URL"
echo "== テスト用 serverId: $SID"
echo
# 注意: GAS の POST は 302 で googleusercontent にリダイレクトされ、
#       追うと HTML が返ることがある（正常）。動作確認は list の差分で判断する。
post() { curl -sS -L -o /dev/null -w "  -> HTTP %{http_code}\n" "$@"; }

echo "--- 1) register（ダミーサーバーを登録）---"
post -X POST "$GAS_URL?action=register" \
  -H "Content-Type: application/json" \
  -d "{\"serverId\":\"$SID\",\"color\":\"red\",\"label\":\"テスト赤\",\"apiUrl\":\"https://example.com\"}"

echo "--- 2) list（enabled=true / lastSeen が入っているか）---"
curl -sS -L "$GAS_URL?action=list"
echo; echo

echo "--- 3) heartbeat（lastSeen が更新される）---"
post -X POST "$GAS_URL?action=heartbeat" \
  -H "Content-Type: application/json" \
  -d "{\"serverId\":\"$SID\"}"

echo "--- 4) list（lastSeen が進んでいるか確認）---"
curl -sS -L "$GAS_URL?action=list"
echo; echo

echo "✅ 完了。Sheets の servers シートに $SID の行ができているはず。"
echo "   テスト行は手で消すか、?action=disable で無効化してください。"
