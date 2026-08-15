#!/usr/bin/env bash
# Python ツール（ruff / pytest）を、環境に応じて解決して実行する。
#
#   bash scripts/py.sh ruff check backend
#   bash scripts/py.sh pytest
#
# backend/.venv があればそれを使い、無ければ PATH のものを使う。
# こうしておくと「venv を有効化し忘れて npm run check が落ちる」が起きず、
# CI（venv を作らず pip install する）でもそのまま動く。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$ROOT/backend/.venv/bin"

TOOL="${1:-}"
if [ -z "$TOOL" ]; then
  echo "使い方: bash scripts/py.sh <ruff|pytest> [引数...]" >&2
  exit 1
fi
shift

# venv を優先する。解決の順番が大事:
#
#   1. `python -m <tool>` … いちばん確実（venv を作り直したり移動しても動く）
#   2. コンソールスクリプト … `lint-imports` のように -m で呼べないもの用。
#      ただし shebang に作成時のパスが焼き込まれているので、venv を移動すると
#      壊れる。だから 2 番目に置く。
if [ -x "$VENV/python" ]; then
  if "$VENV/python" -c "import importlib,sys; importlib.import_module(sys.argv[1])" "$TOOL" 2>/dev/null; then
    exec "$VENV/python" -m "$TOOL" "$@"
  fi
  if [ -x "$VENV/$TOOL" ]; then
    exec "$VENV/$TOOL" "$@"
  fi
fi

if command -v "$TOOL" >/dev/null 2>&1; then
  exec "$TOOL" "$@"
fi

if command -v python3 >/dev/null 2>&1 && python3 -c "import $TOOL" >/dev/null 2>&1; then
  exec python3 -m "$TOOL" "$@"
fi

cat >&2 <<MSG
$TOOL が見つかりません。バックエンドの開発環境を用意してください:

  cd backend
  python3 -m venv .venv
  . .venv/bin/activate
  pip install -r requirements-dev.txt
MSG
exit 1
