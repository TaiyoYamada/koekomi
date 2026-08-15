# コエコミの開発コマンド。
#
#   make setup   … 初回セットアップ（これ1つで動く状態になる）
#   make check   … PR前の全確認
#   make dev     … フロント + バックエンド（ダミーTTS）を同時に起動
#
# npm scripts でも同じことができます（CONTRIBUTING.md 参照）。
# Makefile は「初めて触る人が最初に打つもの」を1箇所にまとめる目的です。

SHELL := /bin/bash
VENV  := backend/.venv
PY    := $(VENV)/bin/python

.DEFAULT_GOAL := help
.PHONY: help setup check fix dev dev-backend test e2e load-test api-types clean

help: ## このヘルプを表示
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

setup: ## 初回セットアップ（Node と Python の依存を入れる）
	npm install
	@test -d $(VENV) || python3 -m venv $(VENV)
	$(PY) -m pip install --quiet --upgrade pip
	$(PY) -m pip install --quiet -r backend/requirements-dev.txt
	@test -f frontend/.env || cp frontend/.env.example frontend/.env
	@echo ""
	@echo "  ✅ 準備できました。"
	@echo "     frontend/.env に VITE_GAS_URL と VITE_EVENT_TOKEN を書いてください。"
	@echo "     動かすには: make dev"

check: ## PR前の全確認（format / lint / 型 / テスト）
	npm run check

fix: ## 自動修正（整形と lint --fix）
	npm run fix

dev: ## フロントとバックエンド（ダミーTTS）を同時に起動
	@echo "バックエンド: http://127.0.0.1:8000 / フロント: http://localhost:5173"
	@trap 'kill 0' EXIT; \
	  (cd backend && TTS_BACKEND=dummy $(CURDIR)/$(PY) -m uvicorn app.main:app --reload --port 8000) & \
	  npm run dev --workspace frontend & \
	  wait

dev-backend: ## バックエンドだけ起動（ダミーTTS）
	cd backend && TTS_BACKEND=dummy ../$(PY) -m uvicorn app.main:app --reload --port 8000

test: ## 単体テスト（フロント + バックエンド）
	npm run test

e2e: ## ブラウザでの通しテスト
	npm run e2e

load-test: ## 10人同時の負荷テスト（先にバックエンドを起動しておく）
	python3 scripts/load-test.py http://127.0.0.1:8000 --children 10

api-types: ## OpenAPI からフロントの型を生成し直す
	npm run api:types

clean: ## 生成物を消す
	rm -rf frontend/dist .e2e-tmp playwright-report test-results
	rm -rf backend/artifacts backend/tmp backend/cache
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
