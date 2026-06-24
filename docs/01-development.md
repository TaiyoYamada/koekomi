# 01. 開発環境の起動方法

## 必要なもの

- Node.js 18 以上
- Python 3.10 以上
- （任意）ffmpeg … 録音を wav に変換する。無くてもダミーでは動く。
- （任意）ngrok … iPad 実機確認や Colab 公開に使う。

---

## フロントエンド

```bash
# リポジトリ直下
npm install                              # workspace 一括インストール
cp frontend/.env.example frontend/.env   # 設定ファイル作成
```

`frontend/.env` を編集:

```
VITE_GAS_URL=https://script.google.com/macros/s/XXXX/exec
VITE_SERVER_FRESH_SECONDS=120
```

> GAS をまだ用意していない場合は空のままでもアプリは起動します。
> その場合 AI モードでは「サーバーに つなげませんでした」と表示されるので、
> 管理画面（`/admin`）からフォールバックモードに切り替えて UI を確認できます。

起動:

```bash
npm run dev          # http://localhost:5173
```

ビルド（型チェック込み）:

```bash
npm run build
npm run preview      # ビルド成果物を確認
```

---

## バックエンド

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # 任意。既定値（dummy）で動く
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

確認:

```bash
curl http://localhost:8000/health
# {"status":"ok", ... "transcribeBackend":"dummy","ttsBackend":"dummy", ...}
```

---

## ローカルでフロント↔バックをつなぐ（GAS なしで試す）

GAS を用意せず、手元の FastAPI に直接つなぎたいときは、ブラウザのコンソールで
localStorage に接続先を入れてしまうのが手軽です。

```js
localStorage.setItem('vct.assignment', JSON.stringify({
  serverId: 'local', color: 'blue', label: 'ローカル',
  apiUrl: 'http://localhost:8000', assignedAt: Date.now()
}))
```

その後リロードすると、保存済み接続先の `/health` が通ればそのまま使われます。

---

## ダミー実装について

- **文字起こし**: 録音内容に関わらずサンプル文を返す（`adapters/dummy_transcriber.py`）。
- **AI音声**: コマごとに高さ・長さの違うトーン音 wav を生成する（`adapters/dummy_tts.py`）。

これにより、Whisper / QwenTTS を入れる前から
「えをえらぶ → セリフ → 録音 → 文字起こし → AI音声 → 4コマ劇場再生」まで一通り動きます。

本実装への差し替えは [03-colab-backend.md](03-colab-backend.md) を参照。
