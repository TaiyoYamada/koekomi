"""
Colab 上で FastAPI バックエンドを起動し、ngrok で公開して GAS に登録する。

Colab のノートブック最後のセルで実行する想定:

    !git clone https://github.com/<you>/voice-comic-theater.git
    %cd voice-comic-theater
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
    # dummy 以外（Qwen3-TTS / Whisper）を使うなら AI 用の重い依存も入れる。
    # 失敗してもサーバーは起動する（service 層が dummy にフォールバックする）。
    tts = os.environ.get("TTS_BACKEND", "qwen").lower()
    stt = os.environ.get("TRANSCRIBE_BACKEND", "whisper").lower()
    if tts != "dummy" or stt != "dummy":
        print("   AI（Qwen3-TTS / Whisper）用ライブラリも入れます…（数分かかることがあります）")
        # 失敗が見えるよう -q は付けない（dummy になる原因の切り分け用）。
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-r", "backend/requirements-ai.txt"],
        )
        if result.returncode != 0:
            print("   ⚠️ AI用ライブラリのインストールに失敗しました（このままだと dummy=ピー音になります）")
            print("      上のpipエラーを確認してください。qwen-tts / openai-whisper が入っているか。")
        else:
            # 入ったか実際に import で確認する。
            check = subprocess.run(
                [sys.executable, "-c", "import torch, qwen_tts, whisper; print('AI deps OK')"],
            )
            if check.returncode != 0:
                print("   ⚠️ ライブラリは入ったが import に失敗しています（dummyになります）。上のエラーを確認。")


def start_backend() -> threading.Thread:
    print("[2/5] FastAPI を起動中…")
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


def _download_cloudflared() -> str:
    """cloudflared バイナリ（linux amd64）を取得して実行パスを返す。"""
    path = os.path.abspath("cloudflared")
    if not os.path.exists(path):
        url = (
            "https://github.com/cloudflare/cloudflared/releases/latest/download/"
            "cloudflared-linux-amd64"
        )
        urllib.request.urlretrieve(url, path)  # noqa: S310 (github 公式リリース)
        os.chmod(path, 0o755)
    return path


def open_cloudflare() -> str:
    """Cloudflare Quick Tunnel を張り、発行された https URL を返す（鍵・アカウント不要）。"""
    global _cloudflared_proc
    print("[3/5] Cloudflare Quick Tunnel で外部公開中…")
    bin_path = _download_cloudflared()
    _cloudflared_proc = subprocess.Popen(
        [bin_path, "tunnel", "--no-autoupdate", "--url", f"http://localhost:{PORT}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    pattern = re.compile(r"https://[-a-z0-9]+\.trycloudflare\.com")
    deadline = time.time() + 40
    assert _cloudflared_proc.stdout is not None
    while time.time() < deadline:
        line = _cloudflared_proc.stdout.readline()
        if not line:
            if _cloudflared_proc.poll() is not None:
                raise RuntimeError("cloudflared が予期せず終了しました")
            continue
        m = pattern.search(line)
        if m:
            url = m.group(0)
            print(f"   公開URL: {url}")
            # 残りの出力を読み捨てる（パイプ詰まりでトンネルが固まるのを防ぐ）。
            threading.Thread(target=_drain, args=(_cloudflared_proc,), daemon=True).start()
            return url
    raise RuntimeError("Cloudflare の公開URLを取得できませんでした")


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


def register_to_gas(api_url: str) -> None:
    print("[4/5] GAS にサーバーを登録中…")
    if not GAS_URL:
        print("   GAS_URL 未設定のため登録をスキップします。")
        return
    try:
        res = requests.post(
            GAS_URL,
            params={"action": "register"},
            json={
                "serverId": SERVER_ID,
                "color": SERVER_COLOR,
                "label": SERVER_LABEL,
                "apiUrl": api_url,
                "capacity": CAPACITY,
            },
            timeout=15,
        )
        print(f"   register: HTTP {res.status_code} {res.text[:120]}")
    except requests.RequestException as e:
        print(f"   register に失敗: {e}")


def heartbeat_loop(api_url: str) -> None:
    print(f"[5/5] heartbeat を {HEARTBEAT_SEC} 秒ごとに送信します（停止するまで継続）。")
    while True:
        time.sleep(HEARTBEAT_SEC)
        if not GAS_URL:
            continue
        try:
            requests.post(
                GAS_URL,
                params={"action": "heartbeat"},
                json={"serverId": SERVER_ID, "apiUrl": api_url},
                timeout=10,
            )
        except requests.RequestException as e:
            print(f"   heartbeat に失敗: {e}")


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
