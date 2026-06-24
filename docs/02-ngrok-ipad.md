# 02. ngrok を使って iPad から確認する方法

ブラウザでのマイク録音は **HTTPS が必須**です（`localhost` は例外）。
iPad の Safari から実機確認するときは ngrok の HTTPS URL を使います。

---

## 準備

1. [ngrok](https://ngrok.com/) でアカウントを作り、authtoken を取得。
2. ローカルに ngrok をインストールし、トークンを設定。

```bash
ngrok config add-authtoken <YOUR_TOKEN>
```

---

## フロントエンドを公開する

```bash
npm run dev            # 別ターミナルで Vite を起動（5173）
npm run ngrok:front    # = ngrok http 5173
```

- Vite 設定（`frontend/vite.config.ts`）は `host: true` と `allowedHosts: true` 済みなので、
  ngrok の動的ホスト名でもそのまま開けます。
- 表示された `https://xxxx.ngrok-free.app` を iPad の Safari で開きます。

## バックエンドを公開する

```bash
# backend 側を起動してから
npm run ngrok:back     # = ngrok http 8000
```

- フロントの接続先（`apiUrl`）をこの ngrok URL にすれば、ローカルの FastAPI を iPad から叩けます。
- `api.ts` は `ngrok-skip-browser-warning` ヘッダを送るので、ngrok の警告ページを回避します。

---

## iPad で開く手順

1. Safari で フロントの URL を開く（**QR は必須ではありません**。固定URLを開くだけでOK）。
2. 画面上部に **「あなたは ○サーバー です」** と色付きで接続先が出る。
3. 「声をろくおんする」でマイク許可ダイアログ → **許可**。
4. そのまま録音 → プレビュー再生 → 文字起こし → AI音声 → 4コマ劇場。

---

## よくあるトラブル

| 症状 | 対処 |
|---|---|
| 録音ボタンが押せない／無音 | HTTPS で開いているか確認。`http://` だと iOS は録音不可。 |
| マイク許可が出ない | Safari の設定 > Webサイト > マイク、または「サイト越え~」を確認。 |
| ngrok 警告ページが出る | フロント経由のAPIは自動回避。直接URLを開いた時は一度「Visit Site」を押す。 |
| `allowedHosts` で弾かれる | `vite.config.ts` の `allowedHosts: true` を確認（設定済み）。 |
| iPad で音が出ない | 一度画面をタップしてから再生（iOS は自動再生制限あり）。本アプリは再生ボタンを押す導線なのでOK。 |

---

## 本番との違い

- **開発中**: フロントもバックも ngrok でOK。
- **本番**: フロントは固定URLでホスティング（Vercel など）。バックエンドだけ Colab + ngrok。
  → 子どもは毎回同じフロントURLを開くだけ。接続先Colabは GAS 経由で自動割り当て。
