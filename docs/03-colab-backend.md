# 03. Colab でバックエンドを起動する方法

1台の Colab = 1サーバー。本番では 5〜10台を開きます（台数は固定不要）。

---

## 前提

- GAS をデプロイ済みで `GAS_URL`(/exec) がある（[04-gas-sheets.md](04-gas-sheets.md)）。
- ngrok の authtoken がある。
- リポジトリが GitHub などから `git clone` できる。

---

## 手順（notebook を使う場合）

`colab/start_backend.ipynb` を Colab で開き、上から順に実行します。

### セル1: リポジトリ取得

```python
!git clone https://github.com/<YOUR_NAME>/voice-comic-theater.git
%cd voice-comic-theater
```

### セル2: 設定（秘密情報はシークレットから）

Colab 左の 🔑（シークレット）に `NGROK_AUTHTOKEN` と `GAS_URL` を登録しておきます。

```python
import os
from google.colab import userdata
os.environ['NGROK_AUTHTOKEN'] = userdata.get('NGROK_AUTHTOKEN')
os.environ['GAS_URL']         = userdata.get('GAS_URL')

os.environ['SERVER_ID']    = 'colab-1'   # 台ごとに変える
os.environ['SERVER_COLOR'] = 'red'       # 台ごとに変える
os.environ['SERVER_LABEL'] = '赤サーバー'
os.environ['CAPACITY']     = '2'         # 1台 1〜2人
```

> **トークン等をコードに直書きしないこと。** 必ず環境変数（シークレット）から渡します。

### セル3: 起動

```python
%run colab/colab_runner.py
```

`colab_runner.py` が自動で次を実行します:

1. `backend/requirements.txt` をインストール
2. FastAPI を別スレッドで起動（`uvicorn`）
3. ngrok でHTTPS公開URLを発行
4. そのURLを GAS に `register`
5. 30秒ごとに GAS へ `heartbeat`（`lastSeen` 更新）

このセルは **実行したまま** にしておきます（止めるとサーバーが落ちます）。

---

## 10台分の色/ID 早見表

| ID | color | label |
|----|-------|-------|
| colab-1 | red | 赤サーバー |
| colab-2 | blue | 青サーバー |
| colab-3 | green | 緑サーバー |
| colab-4 | yellow | 黄サーバー |
| colab-5 | purple | 紫サーバー |
| colab-6 | orange | オレンジサーバー |
| colab-7 | pink | ピンクサーバー |
| colab-8 | cyan | 水色サーバー |
| colab-9 | brown | 茶色サーバー |
| colab-10 | black | 黒サーバー |

色キーは `frontend/src/lib/colors.ts` と一致させること。

---

## Whisper / QwenTTS への差し替え

ダミーから本実装に切り替えるには、Colab のセル2に追記:

```python
os.environ['TRANSCRIBE_BACKEND'] = 'whisper'   # 文字起こしを Whisper に
os.environ['WHISPER_MODEL']      = 'base'
os.environ['TTS_BACKEND']        = 'qwen'       # 音声生成を QwenTTS に
```

そして:

- **Whisper**: `backend/requirements.txt` の `faster-whisper`（または `openai-whisper`）を有効化。
  実装は `backend/app/adapters/whisper_transcriber.py`（すでにロード＆推論の雛形あり）。
- **QwenTTS**: `backend/app/adapters/qwen_tts.py` の `_load()` と `synthesize()` を実装。
  `transformers` / `torch` / `soundfile` などを requirements に追加。
  GPU ランタイム（メニュー > ランタイム > ランタイムのタイプを変更 > GPU）を推奨。

サービス層（`services/transcription.py`・`services/tts.py`）が環境変数で adapter を選ぶので、
**route やフロントは一切変更不要**です。

---

## 同時生成の制御

1つの Colab では `asyncio.Lock`（`backend/app/locks.py`）により
**音声生成が同時に複数走らないよう**になっています（1件ずつ順番に処理）。
2人で1台を共有しても、生成は順番待ちになるだけで競合しません。
