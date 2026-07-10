"""
Colab 上で FastAPI バックエンドを起動し、ngrok で公開して GAS に登録する。

Colab のノートブック最後のセルで実行する想定:

    !git clone https://github.com/<you>/koekomi.git
    %cd koekomi
    # 秘密情報は Colab の「シークレット」または os.environ で渡す（直書きしない）
    import os
    os.environ["NGROK_AUTHTOKEN"] = "..."   # 例: userdata.get('NGROK_AUTHTOKEN')
    os.environ["GAS_URL"]         = "https://script.google.com/macros/s/XXXX/exec"
    os.environ["SERVER_ID"]       = "colab-1"
    os.environ["SERVER_COLOR"]    = "red"
    os.environ["SERVER_LABEL"]    = "赤サーバー"
    os.environ["CAPACITY"]        = "2"
    %run colab/colab_runner.py

設定はすべて環境変数から読む（トークン等をコードに直書きしない）。
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import threading
import time
import urllib.request

import requests

# ---- 設定（すべて環境変数から）-------------------------------------------
# 公開トンネルの種類: "ngrok"（既定） / "cloudflare"
#   - ngrok      : 1アカウント1トンネル。手元での確認向き（NGROK_AUTHTOKEN が必要）
#   - cloudflare : Quick Tunnel。無料で複数同時OK・警告ページ無し。本番(5〜10台)向き（鍵不要）
TUNNEL = os.environ.get("TUNNEL", "ngrok").lower()
NGROK_AUTHTOKEN = os.environ.get("NGROK_AUTHTOKEN", "")
GAS_URL = os.environ.get("GAS_URL", "")
SERVER_ID = os.environ.get("SERVER_ID", "colab-1")
SERVER_COLOR = os.environ.get("SERVER_COLOR", "blue")
SERVER_LABEL = os.environ.get("SERVER_LABEL", "Colabサーバー")
CAPACITY = int(os.environ.get("CAPACITY", "2"))
PORT = int(os.environ.get("PORT", "8000"))
HEARTBEAT_SEC = int(os.environ.get("HEARTBEAT_SEC", "30"))

# バックエンドにも識別情報を渡す（/health で返す用）
os.environ.setdefault("SERVER_ID", SERVER_ID)
os.environ.setdefault("SERVER_COLOR", SERVER_COLOR)
os.environ.setdefault("SERVER_LABEL", SERVER_LABEL)


def install_dependencies() -> None:
    print("[1/5] 依存ライブラリをインストール中…")
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "-q", "-r", "backend/requirements.txt"],
        check=True,
    )
    # dummy 以外（Qwen3-TTS）を使うなら AI 用の重い依存も入れる。
    # 失敗してもサーバーは起動する（service 層が dummy にフォールバックする）。
    tts = os.environ.get("TTS_BACKEND", "qwen").lower()
    if tts != "dummy":
        print("   AI（Qwen3-TTS）用ライブラリも入れます…（数分かかることがあります）")
        # 失敗が見えるよう -q は付けない（dummy になる原因の切り分け用）。
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-r", "backend/requirements-ai.txt"],
        )
        if result.returncode != 0:
            print("   ⚠️ AI用ライブラリのインストールに失敗しました（このままだと dummy=ピー音になります）")
            print("      上のpipエラーを確認してください。qwen-tts が入っているか。")
        else:
            # 入ったか実際に import で確認する。
            check = subprocess.run(
                [sys.executable, "-c", "import torch, qwen_tts; print('AI deps OK')"],
            )
            if check.returncode != 0:
                print("   ⚠️ ライブラリは入ったが import に失敗しています（dummyになります）。上のエラーを確認。")


def start_backend() -> threading.Thread | None:
    print("[2/5] FastAPI を起動中…")

    # セルの再実行では、前回のバックエンドが生きたまま残っていることがある
    # （クラッシュしても uvicorn のスレッドは死なない）。二重起動すると
    # 「address already in use」で紛らわしいので、生きていればそのまま使う。
    try:
        if requests.get(f"http://127.0.0.1:{PORT}/health", timeout=2).ok:
            print("   前回のバックエンドがまだ動いているため、それをそのまま使います。")
            print("   （コードを更新した場合は「ランタイムを再起動」してから実行し直してください）")
            return None
    except requests.RequestException:
        pass  # 動いていない＝普通に起動する

    # backend ディレクトリを import パスに追加して uvicorn をプログラム起動
    sys.path.insert(0, os.path.abspath("backend"))

    def _serve() -> None:
        import uvicorn

        uvicorn.run("app.main:app", host="0.0.0.0", port=PORT, log_level="info")

    t = threading.Thread(target=_serve, daemon=True)
    t.start()
    # 起動待ち
    for _ in range(30):
        try:
            if requests.get(f"http://127.0.0.1:{PORT}/health", timeout=2).ok:
                break
        except requests.RequestException:
            time.sleep(1)
    return t


def open_ngrok() -> str:
    print("[3/5] ngrok で外部公開中…")
    from pyngrok import conf, ngrok

    if NGROK_AUTHTOKEN:
        conf.get_default().auth_token = NGROK_AUTHTOKEN
    tunnel = ngrok.connect(PORT, "http")
    url = tunnel.public_url.replace("http://", "https://")
    print(f"   公開URL: {url}")
    return url


# cloudflared プロセスはトンネルの本体。GC されないよう参照を保持しておく。
_cloudflared_proc: subprocess.Popen | None = None


def _is_elf(path: str) -> bool:
    """Linux 実行バイナリかどうか（壊れたダウンロードや HTML エラーページを弾く）。"""
    try:
        with open(path, "rb") as f:
            return f.read(4) == b"\x7fELF"
    except OSError:
        return False


def _download_cloudflared() -> str:
    """
    cloudflared バイナリ（linux amd64）を取得して実行パスを返す。
    途中で切れたダウンロードを掴まないよう、一時ファイルに落として
    中身を確認してから所定の場所へ置く。既存ファイルも壊れていれば取り直す。
    """
    path = os.path.abspath("cloudflared")
    if _is_elf(path):
        return path
    if os.path.exists(path):
        print("   壊れた cloudflared が残っていたため取り直します。")
        os.remove(path)
    url = (
        "https://github.com/cloudflare/cloudflared/releases/latest/download/"
        "cloudflared-linux-amd64"
    )
    tmp = path + ".download"
    urllib.request.urlretrieve(url, tmp)  # noqa: S310 (github 公式リリース)
    if not _is_elf(tmp):
        os.remove(tmp)
        raise RuntimeError("cloudflared のダウンロードが壊れていました。もう一度実行してください。")
    os.replace(tmp, path)
    os.chmod(path, 0o755)
    return path


def open_cloudflare() -> str:
    """
    Cloudflare Quick Tunnel を張り、発行された https URL を返す（鍵・アカウント不要）。
    Quick Tunnel は混雑時に一時的に拒否されることがあるため、少し置いて数回試す。
    """
    global _cloudflared_proc
    print("[3/5] Cloudflare Quick Tunnel で外部公開中…")
    bin_path = _download_cloudflared()
    pattern = re.compile(r"https://[-a-z0-9]+\.trycloudflare\.com")

    for attempt in range(1, 4):
        if attempt > 1:
            print(f"   {attempt}/3 回目を試します…")
            time.sleep(5)

        proc = subprocess.Popen(
            [bin_path, "tunnel", "--no-autoupdate", "--url", f"http://localhost:{PORT}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        _cloudflared_proc = proc
        assert proc.stdout is not None

        log: list[str] = []
        url: str | None = None
        deadline = time.time() + 40
        while time.time() < deadline:
            line = proc.stdout.readline()
            if not line:
                if proc.poll() is not None:
                    break  # プロセスが終了した
                continue
            log.append(line.rstrip())
            m = pattern.search(line)
            if m:
                url = m.group(0)
                break

        if url:
            print(f"   公開URL: {url}")
            # 残りの出力を読み捨てる（パイプ詰まりでトンネルが固まるのを防ぐ）。
            threading.Thread(target=_drain, args=(proc,), daemon=True).start()
            return url

        # 失敗。原因が分かるよう cloudflared の言い分を表示してから再挑戦する。
        try:
            proc.kill()
            proc.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            pass
        print("   cloudflared がトンネルを張れませんでした。出力（末尾）:")
        for line in log[-12:] or ["（出力なし）"]:
            print(f"     {line}")

    raise RuntimeError(
        "Cloudflare Quick Tunnel を3回試しましたが張れませんでした。"
        "上の出力を確認してください。急ぎの場合は TUNNEL=ngrok でも起動できます。"
    )


def _drain(proc: subprocess.Popen) -> None:
    if proc.stdout is None:
        return
    for _ in proc.stdout:
        pass


def open_tunnel() -> str:
    """TUNNEL 環境変数に応じて公開トンネルを選ぶ。"""
    if TUNNEL == "cloudflare":
        return open_cloudflare()
    return open_ngrok()


def post_gas(action: str, payload: dict, retries: int = 1) -> requests.Response:
    """
    GAS へ POST する。GAS は全リクエストを直列処理していて混雑すると応答が遅いので、
    長めに待ち、タイムアウトしたら少し置いて送り直す。
    """
    last_error: Exception = RuntimeError("unreachable")
    for attempt in range(retries + 1):
        try:
            return requests.post(GAS_URL, params={"action": action}, json=payload, timeout=30)
        except requests.RequestException as e:
            last_error = e
            if attempt < retries:
                time.sleep(3)
    raise last_error


def register_to_gas(api_url: str) -> None:
    print("[4/5] GAS にサーバーを登録中…")
    if not GAS_URL:
        print("   GAS_URL 未設定のため登録をスキップします。")
        return
    try:
        res = post_gas(
            "register",
            {
                "serverId": SERVER_ID,
                "color": SERVER_COLOR,
                "label": SERVER_LABEL,
                "apiUrl": api_url,
                "capacity": CAPACITY,
            },
            retries=2,
        )
        print(f"   register: HTTP {res.status_code} {res.text[:120]}")
    except requests.RequestException as e:
        print(f"   register に失敗: {e}（heartbeat 側で自動的に再登録します）")


def heartbeat_loop(api_url: str) -> None:
    print(f"[5/5] heartbeat を {HEARTBEAT_SEC} 秒ごとに送信します（停止するまで継続）。")
    while True:
        time.sleep(HEARTBEAT_SEC)
        if not GAS_URL:
            continue
        try:
            res = post_gas("heartbeat", {"serverId": SERVER_ID, "apiUrl": api_url})
            # 起動時の register がタイムアウトしていると、heartbeat は「not registered」で
            # 空振りし続け、この台は一覧に載らないままになる。ここで検知して登録し直す。
            if "not registered" in res.text:
                print("   未登録と言われたため register し直します。")
                register_to_gas(api_url)
        except requests.RequestException as e:
            print(f"   heartbeat に失敗: {e}（次の周期で再送します）")


def main() -> None:
    install_dependencies()
    start_backend()
    api_url = open_tunnel()
    register_to_gas(api_url)
    print("\n✅ 準備完了。このセルは動かしたままにしてください。")
    print(f"   tunnel={TUNNEL} serverId={SERVER_ID} color={SERVER_COLOR} url={api_url}\n")
    try:
        heartbeat_loop(api_url)
    except KeyboardInterrupt:
        print("停止しました。")


if __name__ == "__main__":
    main()
