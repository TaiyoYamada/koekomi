#!/usr/bin/env bash
# バックエンドの OpenAPI から、フロントの型を生成する。
#
#   bash scripts/gen-api-types.sh
#
# サーバーを起動せずに、FastAPI アプリから直接スキーマを取り出す。
# これで「サーバーが返す形」と「フロントが期待する形」が1つの定義から出るので、
# バックエンドを変えてフロントを直し忘れると **型エラーで止まる**。
#
# CI では生成し直して差分が無いか確認する（= 生成物が古くないことの保証）。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA="$ROOT/frontend/src/infrastructure/openapi.json"
TYPES="$ROOT/frontend/src/infrastructure/apiSchema.ts"

# backend の venv があればそれを使う（依存が入っているのはそちらだけ）。
PY_BIN="$ROOT/backend/.venv/bin/python"
[ -x "$PY_BIN" ] || PY_BIN="python3"

echo "OpenAPI スキーマを書き出しています…"
cd "$ROOT"
"$PY_BIN" "$ROOT/scripts/dump_openapi.py" "$SCHEMA"

echo "TypeScript の型を生成しています…"
npx --yes openapi-typescript "$SCHEMA" -o "$TYPES"
npx prettier --write "$SCHEMA" "$TYPES" >/dev/null
echo "  → $TYPES"
