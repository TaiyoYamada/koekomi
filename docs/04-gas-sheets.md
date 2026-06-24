# 04. GAS + Google Sheets の準備方法

GAS + Google Sheets を**簡易サーバーレジストリ**として使います（外部DB不要）。

---

## 1. スプレッドシートを作る

1. [Google Sheets](https://sheets.new) で新規スプレッドシートを作成。
2. メニュー **拡張機能 > Apps Script** を開く。

## 2. スクリプトを貼り付ける

1. 既定の `Code.gs` の中身を、本リポジトリの [`gas/Code.gs`](../gas/Code.gs) で置き換える。
2. （任意）`appsscript.json` を表示する設定にして [`gas/appsscript.json`](../gas/appsscript.json) の内容に合わせる
   （プロジェクトの設定 > 「appsscript.json マニフェスト ファイルをエディタで表示する」をON）。

## 3. シートを初期化する

Apps Script エディタで関数 `setup` を一度だけ実行します。
`servers` シートが作られ、以下のヘッダー行が入ります。

```
serverId | color | label | apiUrl | enabled | capacity | assignedCount | lastSeen
```

（初回実行時に承認ダイアログが出るので許可してください。）

## 4. ウェブアプリとしてデプロイ

1. 右上 **デプロイ > 新しいデプロイ**。
2. 種類: **ウェブアプリ**。
3. 設定:
   - 実行するユーザー: **自分**
   - アクセスできるユーザー: **全員**
4. デプロイすると `https://script.google.com/macros/s/XXXX/exec` が発行される。
   これが **`GAS_URL`** です。

> コードを更新したら「デプロイを管理 > 編集 > 新バージョン」で再デプロイします
> （URLは維持されます）。

## 5. URL を各所に設定

- React: `frontend/.env` の `VITE_GAS_URL`
- Colab: シークレット `GAS_URL`（[03-colab-backend.md](03-colab-backend.md)）

---

## API 一覧

ブラウザや Colab から叩く HTTP インターフェース。

### `GET ?action=list`
使えるサーバー一覧を返す。

```json
{ "servers": [
  { "serverId":"colab-1","color":"red","label":"赤サーバー",
    "apiUrl":"https://xxxx.ngrok-free.app","enabled":true,
    "capacity":2,"assignedCount":1,"lastSeen":1719223456000 }
]}
```

### `POST ?action=register`（Colab起動時）
body: `{serverId, color, label, apiUrl, capacity}`
→ 行を作成/更新。`assignedCount=0`・`lastSeen=now`・`enabled=true`。

### `POST ?action=heartbeat`（定期）
body: `{serverId, apiUrl?}`
→ `lastSeen` を更新。生きているサーバーだけが「新しい」状態になる。

### `POST ?action=assign`（割り当て確定時。Reactが呼ぶ）
query/body: `serverId`
→ `assignedCount` を +1。

### `POST ?action=release` / `?action=disable`（運用補助）
→ 割り当て数を減らす / そのサーバーを無効化する。

---

## 動作確認

```bash
# 一覧（最初は空）
curl "https://script.google.com/macros/s/XXXX/exec?action=list"

# 手動でダミー登録
curl -X POST "https://script.google.com/macros/s/XXXX/exec?action=register" \
  -H "Content-Type: application/json" \
  -d '{"serverId":"test","color":"blue","label":"テスト","apiUrl":"https://example.com","capacity":2}'
```

---

## 割り当てロジック（React側）

React は `list` 結果から次の条件で1台を選びます（`frontend/src/lib/registry.ts`）。

1. `enabled === true`
2. `assignedCount < capacity`（空きがある）
3. `now - lastSeen <= VITE_SERVER_FRESH_SECONDS`（heartbeat が新しい）
4. その中で **空き枠が多い順**、同点なら heartbeat が新しい順
5. 候補を上から `/health` 確認し、最初に通った1台に割り当て → localStorage 保存
