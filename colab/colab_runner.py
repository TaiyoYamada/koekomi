"""
Colab 上で FastAPI バックエンドを起動し、Cloudflare Quick Tunnel で公開して
サーバー名簿（GAS）に登録する。

Colab のノートブック最後のセルで実行する想定:

    !git clone https://github.com/<you>/koekomi.git
    %cd koekomi
    import os
    from google.colab import userdata
    os.environ["GAS_URL"]         = userdata.get("GAS_URL")
    os.environ["EVENT_TOKEN"]     = userdata.get("EVENT_TOKEN")   # フロントと同じ文字列
    os.environ["ADMIN_TOKEN"]     = userdata.get("ADMIN_TOKEN")   # /cleanup 用。フロントには配らない
    os.environ["FRONTEND_ORIGIN"] = "https://koekomi.taiyoyamada.com"  # 写真の取得元
    os.environ["CORS_ORIGINS"]    = "https://koekomi.taiyoyamada.com,https://koekomi.vercel.app"
    os.environ["SERVER_ID"]       = "colab-1"
    os.environ["SERVER_COLOR"]    = "red"
    os.environ["SERVER_LABEL"]    = "赤サーバー"
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
GAS_URL = os.environ.get("GAS_URL", "")
SERVER_ID = os.environ.get("SERVER_ID", "colab-1")
SERVER_COLOR = os.environ.get("SERVER_COLOR", "blue")
SERVER_LABEL = os.environ.get("SERVER_LABEL", "Colabサーバー")
PORT = int(os.environ.get("PORT", "8000"))
HEARTBEAT_SEC = int(os.environ.get("HEARTBEAT_SEC", "30"))
FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "").rstrip("/")

# バックエンドにも識別情報を渡す（/health で返す用）
os.environ.setdefault("SERVER_ID", SERVER_ID)
os.environ.setdefault("SERVER_COLOR", SERVER_COLOR)
os.environ.setdefault("SERVER_LABEL", SERVER_LABEL)
# CORS はフロントのオリジンに固定する（既定の "*" に頼らない）。
# CORS_ORIGINS を明示していればそちらが勝つ（カンマ区切りで複数オリジンを許可したい場合）。
if FRONTEND_ORIGIN and not os.environ.get("CORS_ORIGINS"):
    os.environ["CORS_ORIGINS"] = FRONTEND_ORIGIN


def preflight() -> None:
    """起動前に、設定漏れを声に出して警告する。"""
    print("[0/6] 設定を確認します…")
    if not os.environ.get("EVENT_TOKEN"):
        print("   ⚠️ EVENT_TOKEN が未設定です。誰でもこのAPIを叩ける状態になります。")
        print("      子どもの声を扱うので、本番では必ず設定してください。")
    if not os.environ.get("ADMIN_TOKEN"):
        print("   ⚠️ ADMIN_TOKEN が未設定です。後片付け（/cleanup）が使えません。")
        print("      イベント後の削除は、ランタイム停止で代用することになります。")
    if not FRONTEND_ORIGIN:
        print("   ⚠️ FRONTEND_ORIGIN が未設定です。")
        print("      サーバー側での動画作成が使えず、iPad側の書き出し（時間がかかる）になります。")
    if not GAS_URL:
        print("   ⚠️ GAS_URL が未設定です。名簿に載らないので、iPad から見つけてもらえません。")


def install_dependencies() -> None:
    print("[1/6] 依存ライブラリをインストール中…")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "-q",
            "-r",
            "backend/requirements.txt",
        ],
        check=True,
    )

    # 日本語フォント（動画に字幕を焼き込むのに必要）。
    # 無いと /health の canRender=false になり、iPad側の書き出しに落ちる。
    print("   日本語フォントを確認中…")
    try:
        subprocess.run(
            ["apt-get", "install", "-y", "-qq", "fonts-noto-cjk"],
            check=False,
            capture_output=True,
            timeout=300,
        )
    except (OSError, subprocess.SubprocessError) as e:
        print(f"   フォントを入れられませんでした（動画はiPad側で作ります）: {e}")

    # dummy 以外（Qwen3-TTS）を使うなら AI 用の重い依存も入れる。
    # 失敗してもサーバーは起動する（dummy にフォールバックする）。
    tts = os.environ.get("TTS_BACKEND", "qwen").lower()
    if tts != "dummy":
        print("   AI（Qwen3-TTS）用ライブラリも入れます…（数分かかることがあります）")
        # 失敗が見えるよう -q は付けない（dummy になる原因の切り分け用）。
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "-r",
                "backend/requirements-ai.txt",
            ]
        )
        if result.returncode != 0:
            print("   ⚠️ AI用ライブラリのインストールに失敗しました（このままだと dummy=ピー音になります）")
        else:
            check = subprocess.run([sys.executable, "-c", "import torch, qwen_tts; print('AI deps OK')"])
            if check.returncode != 0:
                print("   ⚠️ ライブラリは入ったが import に失敗しています（dummyになります）。上のエラーを確認。")


def start_backend() -> threading.Thread | None:
    print("[2/6] FastAPI を起動中…")

    # セルの再実行では、前回のバックエンドが生きたまま残っていることがある。
    try:
        if requests.get(f"http://127.0.0.1:{PORT}/health", timeout=2).ok:
            print("   前回のバックエンドがまだ動いているため、それをそのまま使います。")
            print("   （コードを更新した場合は「ランタイムを再起動」してから実行し直してください）")
            return None
    except requests.RequestException:
        pass  # 動いていない＝普通に起動する

    sys.path.insert(0, os.path.abspath("backend"))

    def _serve() -> None:
        import uvicorn

        uvicorn.run("app.main:app", host="0.0.0.0", port=PORT, log_level="info")

    t = threading.Thread(target=_serve, daemon=True)
    t.start()
    for _ in range(30):
        try:
            if requests.get(f"http://127.0.0.1:{PORT}/health", timeout=2).ok:
                break
        except requests.RequestException:
            time.sleep(1)
    return t


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
    """cloudflared バイナリを取得して実行パスを返す。壊れていれば取り直す。"""
    path = os.path.abspath("cloudflared")
    if _is_elf(path):
        return path
    if os.path.exists(path):
        print("   壊れた cloudflared が残っていたため取り直します。")
        os.remove(path)
    url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
    tmp = path + ".download"
    # 取得先は GitHub の公式リリース固定（ユーザー入力は入らない）。
    urllib.request.urlretrieve(url, tmp)
    if not _is_elf(tmp):
        os.remove(tmp)
        raise RuntimeError("cloudflared のダウンロードが壊れていました。もう一度実行してください。")
    os.replace(tmp, path)
    os.chmod(path, 0o755)
    return path


def open_cloudflare() -> str:
    """Cloudflare Quick Tunnel を張り、発行された https URL を返す。"""
    global _cloudflared_proc
    print("[3/6] Cloudflare Quick Tunnel で外部公開中…")
    bin_path = _download_cloudflared()
    pattern = re.compile(r"https://[-a-z0-9]+\.trycloudflare\.com")

    for attempt in range(1, 4):
        if attempt > 1:
            print(f"   {attempt}/3 回目を試します…")
            time.sleep(5)

        proc = subprocess.Popen(
            [
                bin_path,
                "tunnel",
                "--no-autoupdate",
                "--url",
                f"http://localhost:{PORT}",
            ],
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
        "上の出力を確認してください。少し時間を置いて再実行してください。"
    )


def _drain(proc: subprocess.Popen) -> None:
    if proc.stdout is None:
        return
    for _ in proc.stdout:
        pass


def post_gas(action: str, payload: dict, retries: int = 1) -> requests.Response:
    """GAS へ POST する。混雑時に備えて長めに待ち、失敗したら少し置いて送り直す。"""
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
    print("[4/6] サーバー名簿に登録中…")
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
            },
            retries=2,
        )
        print(f"   register: HTTP {res.status_code} {res.text[:120]}")
    except requests.RequestException as e:
        print(f"   register に失敗: {e}（heartbeat 側で自動的に再登録します）")


def self_check(api_url: str) -> None:
    """起動できたか自分で確認して、当日の詰まりどころを先に見せる。"""
    print("[5/6] 自己チェック…")
    try:
        health = requests.get(f"{api_url}/health", timeout=20).json()
    except (requests.RequestException, ValueError) as e:
        print(f"   ⚠️ /health を読めませんでした: {e}")
        return

    tts = health.get("ttsEffective")
    print(f"   状態: {health.get('status')}  音声: {tts}  動画: {'サーバー' if health.get('canRender') else 'iPad側'}")
    if tts != "qwen":
        print(f"   ⚠️ AI音声が使えていません（{tts}）。理由: {health.get('ttsFallback')}")
        print("      このままだとピー音になります。上の pip のエラーを確認してください。")
    if not health.get("canRender"):
        print("   ⚠️ 動画はiPad側で書き出します（時間がかかります）。FRONTEND_ORIGIN とフォントを確認。")
    if health.get("status") == "warming":
        print("   モデルを読み込み中です。終わるまで、この台は割り当てられません（数分）。")


def heartbeat_loop(api_url: str) -> None:
    print(f"[6/6] heartbeat を {HEARTBEAT_SEC} 秒ごとに送信します（停止するまで継続）。")
    while True:
        time.sleep(HEARTBEAT_SEC)
        if not GAS_URL:
            continue
        try:
            res = post_gas("heartbeat", {"serverId": SERVER_ID, "apiUrl": api_url})
            # 起動時の register が失敗していると heartbeat は空振りし続ける。
            # ここで検知して登録し直す。
            if "not registered" in res.text:
                print("   未登録と言われたため register し直します。")
                register_to_gas(api_url)
        except requests.RequestException as e:
            print(f"   heartbeat に失敗: {e}（次の周期で再送します）")


def main() -> None:
    preflight()
    install_dependencies()
    start_backend()
    api_url = open_cloudflare()
    register_to_gas(api_url)
    self_check(api_url)
    print("\n✅ 準備完了。")
    print(f"   serverId={SERVER_ID} color={SERVER_COLOR}")
    print(f"   url={api_url}")
    print("\n   当日の確認: 手元のPCで")
    print(f"     bash scripts/smoke-test.sh {api_url} <EVENT_TOKEN>")
    print("\n   ⚠️ イベントが終わったら必ずランタイムを停止してください")
    print("      （バックグラウンド実行のままだとコンピューティングユニットを消費し続けます）。\n")
    try:
        heartbeat_loop(api_url)
    except KeyboardInterrupt:
        print("停止しました。")


if __name__ == "__main__":
    main()
