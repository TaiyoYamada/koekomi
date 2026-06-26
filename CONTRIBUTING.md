# コントリビューションガイド

コエコミ（`koekomi`）への変更の進め方をまとめます。
セットアップや構成の詳細は [README.md](./README.md) と [`docs/`](./docs) を参照してください。

---

## コミットメッセージの書き方

**`型: 日本語の説明`** の形式で書きます。型は半角英語、説明は**日本語**です。

```
feat: 4コマ劇場に自動再生の速度設定を追加
fix: 同時アクセス時の無限待ちを解消（生成タイムアウト）
docs: Colab 起動手順を更新
```

- 先頭の型（`feat` など）は**一例**です。下の一覧から内容に合うものを選んでください。
- 型のあとは `: `（コロン＋半角スペース）、続けて**何をしたか**を日本語で簡潔に書きます。
- 1行目（タイトル）は 50 文字程度まで。詳しい背景は1行空けて本文に書きます。

### 型の一覧

| 型 | 使うとき | 例 |
|---|---|---|
| `feat` | 機能の追加 | `feat: 先生用の一括リセットボタンを追加` |
| `fix` | バグ修正 | `fix: 録音が iPad で止まる問題を修正` |
| `docs` | ドキュメントのみの変更 | `docs: フォールバック手順を追記` |
| `style` | 動作に影響しない見た目・整形 | `style: ボタンの余白を調整` |
| `refactor` | 挙動を変えないコード整理 | `refactor: TTS の adapter 層を整理` |
| `test` | テストの追加・修正 | `test: 割り当てロジックのテストを追加` |
| `chore` | 設定・依存・雑務 | `chore: 依存ライブラリを更新` |
| `perf` | パフォーマンス改善 | `perf: 起動時にモデルを先読みして初回待ちを短縮` |

迷ったら `feat`（増やした）／`fix`（直した）／`chore`（その他）のどれかで十分です。

---

## 変更の進め方

1. `main` から作業用ブランチを切る（例: `git switch -c fix/voice-timeout`）。
2. 変更を加える。**既存コードのスタイル・命名・コメント量に合わせる**。
3. 下の「コミット前チェック」を緑にする。
4. 上の規約でコミットする。
5. PR を作る（変更内容と確認方法を日本語で書く）。

---

## コミット前チェック

変更した範囲のテスト・Lint・型チェックを通してからコミットします。

### フロントエンド（`frontend/`）

```bash
npm run test:run --workspace frontend     # ユニットテスト（Vitest）
npm run lint --workspace frontend         # ESLint
npm run typecheck --workspace frontend    # 型チェック（tsc）
```

### バックエンド（`backend/`）

```bash
cd backend && . .venv/bin/activate
pip install -r requirements-dev.txt       # 初回のみ
pytest                # API・サービス層のテスト
ruff check .          # Lint
ruff format --check . # フォーマット確認
```

> バックエンドのテストには FastAPI などの依存が必要です。Colab 本番では AI 用の重い依存（torch / qwen-tts）も入りますが、ローカルのテストは `requirements-dev.txt` だけで動きます。

push / PR では GitHub Actions（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）が frontend・backend 両方を自動実行します。**CI は緑にしてからマージ**します。

GAS の動作確認は次で行えます。

```bash
bash scripts/test-gas.sh <GAS_URL>   # register → list → assign → heartbeat → list
```

---

## コーディングの方針

- **UI の表示は漢字＋ふりがな**（小学生向け）。`Furigana` コンポーネントを使います。
- 秘密情報（トークン・URL）は**コードに直書きしない**。環境変数（Colab はシークレット）から読みます。
- バックエンドは**サービス層／adapter 層**に分かれています。TTS の差し替えは `backend/app/adapters/` で行います。
- 1つの Colab では `asyncio.Lock`（`backend/app/locks.py`）で**音声生成を1件ずつ**処理します。重い処理は `asyncio.to_thread` に逃がし、タイムアウトを付けてイベントループを塞がない／無限待ちにしないこと。

---

## 質問・相談

仕様で迷ったら、実装の前に Issue か PR の下書きで相談してください。小さく出して壁打ちしながら進める方針です。
