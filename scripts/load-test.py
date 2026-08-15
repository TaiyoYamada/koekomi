#!/usr/bin/env python3
"""同時アクセスの負荷テスト。**当日いちばん怖い瞬間を先に踏む**ためのもの。

このアプリで壊れる可能性が一番高いのは「授業開始の合図で全員が同時に押す」
場面なのに、そこだけ実測していなかった。子ども N 人ぶんの
`POST /voices → POST /jobs → GET /jobs（完了まで）→ GET /artifacts`
を同時に流し、待ち時間の分布とキューの深さを出す。

    python3 scripts/load-test.py https://xxx.trycloudflare.com --token himitsu --children 10

出るもの:
  - 1行あたりの生成時間（当日の待ち時間の見積もりに使う）
  - 子どもごとの体感待ち時間（p50 / p90 / 最大）
  - キューの最大深さ（「あと○にんまち」の妥当性）
  - 失敗した行の数

標準ライブラリだけで動く（Colab にも手元にも余計なものを入れない）。
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
import wave
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from io import BytesIO

# 4コマ×セリフの想定。実際の作品に近い行数にする。
DEFAULT_LINES = [
    "おはよう",
    "きょうは いい てんきだね",
    "こうえんに いこうよ",
    "うん、いこう！",
    "わあ、きれいな はなが さいてる",
    "しゃしんを とろう",
    "はい、チーズ",
    "たのしかったね",
]


@dataclass
class ChildResult:
    """子ども1人ぶんの結果。"""

    index: int
    enroll_sec: float = 0.0
    total_sec: float = 0.0
    lines: int = 0
    ok_lines: int = 0
    failed_lines: int = 0
    max_queue_position: int = 0
    error: str | None = None
    # 1行目が手元に届くまで（子どもが「動いてる」と感じるまでの時間）
    first_line_sec: float | None = None


@dataclass
class Sampler:
    """/health を定期的に見て、キューの深さを記録する。"""

    api: str
    token: str
    interval: float = 0.5
    depths: list[int] = field(default_factory=list)
    _stop: threading.Event = field(default_factory=threading.Event)

    def start(self) -> None:
        threading.Thread(target=self._loop, daemon=True).start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.wait(self.interval):
            try:
                body = get_json(f"{self.api}/health", self.token, timeout=5)
                self.depths.append(int(body.get("queueDepth", 0)))
            except Exception:  # 計測が本体を邪魔しない
                pass


# ---- HTTP（標準ライブラリだけ） ---------------------------------------------


def request(
    url: str,
    token: str,
    *,
    method: str = "GET",
    data: bytes | None = None,
    content_type: str | None = None,
    timeout: float = 60,
) -> bytes:
    req = urllib.request.Request(url, data=data, method=method)
    if token:
        req.add_header("X-Event-Token", token)
    if content_type:
        req.add_header("Content-Type", content_type)
    with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310
        return res.read()


def get_json(url: str, token: str, timeout: float = 60) -> dict:
    return json.loads(request(url, token, timeout=timeout))


def post_json(url: str, token: str, payload: dict, timeout: float = 60) -> dict:
    body = json.dumps(payload).encode()
    return json.loads(
        request(url, token, method="POST", data=body, content_type="application/json", timeout=timeout)
    )


def post_multipart(url: str, token: str, fields: dict[str, str], filename: str, blob: bytes) -> dict:
    """multipart/form-data を手で組む（requests を足さないため）。"""
    boundary = f"----koekomi{uuid.uuid4().hex}"
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        )
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="audio"; filename="{filename}"\r\n'
        f"Content-Type: audio/wav\r\n\r\n".encode()
    )
    parts.append(blob)
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    return json.loads(
        request(
            url,
            token,
            method="POST",
            data=b"".join(parts),
            content_type=f"multipart/form-data; boundary={boundary}",
            timeout=120,
        )
    )


def make_reference_wav(seconds: float = 8.0, rate: int = 16000) -> bytes:
    """子どもが固定スクリプトを読んだ想定の長さの wav（中身は静かなトーン）。"""
    buf = BytesIO()
    with wave.open(buf, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for i in range(int(rate * seconds)):
            frames += int(6000 * math.sin(2 * math.pi * 180 * i / rate)).to_bytes(
                2, "little", signed=True
            )
        w.writeframes(bytes(frames))
    return buf.getvalue()


# ---- 1人ぶんの流れ -----------------------------------------------------------


def run_child(index: int, api: str, token: str, lines: list[str], audio: bytes) -> ChildResult:
    result = ChildResult(index=index, lines=len(lines))
    started = time.time()
    try:
        # 1) 声を1回だけ預ける
        t0 = time.time()
        voice = post_multipart(
            f"{api}/voices",
            token,
            {"reference_text": "きょうは とても いい てんきです。"},
            "reference.wav",
            audio,
        )
        result.enroll_sec = time.time() - t0
        voice_id = voice["voiceId"]

        # 2) 全セリフを1ジョブで投げる
        job = post_json(f"{api}/jobs", token, {"voiceId": voice_id, "lines": lines})
        job_id = job["jobId"]

        # 3) 完了までポーリングし、できた行から落とす（本番の挙動と同じ）
        downloaded: set[int] = set()
        deadline = time.time() + 900
        while time.time() < deadline:
            status = get_json(f"{api}/jobs/{job_id}", token, timeout=30)
            result.max_queue_position = max(result.max_queue_position, status.get("queuePosition", 0))

            for r in status.get("results", []):
                if r.get("artifactId") and r["index"] not in downloaded:
                    downloaded.add(r["index"])
                    request(f"{api}/artifacts/{r['artifactId']}", token, timeout=60)
                    if result.first_line_sec is None:
                        result.first_line_sec = time.time() - started

            if status["state"] in ("done", "failed", "cancelled"):
                result.ok_lines = sum(1 for r in status["results"] if r.get("artifactId"))
                result.failed_lines = len(status["results"]) - result.ok_lines
                if status["state"] != "done":
                    result.error = status.get("error") or status["state"]
                break
            time.sleep(1)
        else:
            result.error = "タイムアウト（15分）"

        # 4) 後片付け（本番でも録り直し時に消している）
        try:
            request(f"{api}/voices/{voice_id}", token, method="DELETE", timeout=15)
        except Exception:
            pass

    except urllib.error.HTTPError as e:
        result.error = f"HTTP {e.code}: {e.read()[:120].decode('utf-8', 'replace')}"
    except Exception as e:  # noqa: BLE001
        result.error = f"{type(e).__name__}: {e}"

    result.total_sec = time.time() - started
    return result


# ---- 集計 -------------------------------------------------------------------


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * p
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    if lo == hi:
        return ordered[lo]
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def report(results: list[ChildResult], depths: list[int], wall_sec: float, lines_each: int) -> bool:
    ok = [r for r in results if r.error is None]
    ng = [r for r in results if r.error is not None]
    totals = [r.total_sec for r in ok]
    firsts = [r.first_line_sec for r in ok if r.first_line_sec is not None]
    total_lines = sum(r.lines for r in results)
    ok_lines = sum(r.ok_lines for r in results)

    print()
    print("=" * 62)
    print(f" 結果: {len(ok)}/{len(results)} 人が完走 / 全体 {wall_sec:.1f} 秒")
    print("=" * 62)
    print(f"  1人あたりのセリフ数      : {lines_each}")
    print(f"  生成できた行             : {ok_lines}/{total_lines}")
    if totals:
        print()
        print("  子どもの体感待ち時間（声を預けてから全部そろうまで）")
        print(f"    p50 {percentile(totals, 0.5):6.1f}秒   p90 {percentile(totals, 0.9):6.1f}秒   最大 {max(totals):6.1f}秒")
        print()
        print(f"  1行あたり（平均）        : {statistics.mean(totals) / lines_each:.2f} 秒")
        if firsts:
            print(f"  最初の1行が届くまで      : p50 {percentile(firsts, 0.5):.1f}秒（「動いてる」と感じるまで）")
    if depths:
        print()
        print(f"  キューの最大深さ         : {max(depths)} 行（未処理）")
        print(f"  キューの平均深さ         : {statistics.mean(depths):.1f} 行")
    if ng:
        print()
        print(f"  ❌ 失敗した子: {len(ng)} 人")
        for r in ng[:5]:
            print(f"     #{r.index}: {r.error}")

    print()
    if totals:
        worst = max(totals)
        if worst > 300:
            print(f"  ⚠️ 最大 {worst:.0f} 秒待ち。子どもには長すぎます。")
            print("     WORKERS を増やすか、台数を増やすか、セリフ数の上限を下げてください。")
        elif worst > 120:
            print(f"  △ 最大 {worst:.0f} 秒待ち。待ち順位の表示が効いていれば許容範囲です。")
        else:
            print(f"  ✅ 最大 {worst:.0f} 秒待ち。この規模なら問題ありません。")
    print("=" * 62)
    return not ng and ok_lines == total_lines


def main() -> int:
    parser = argparse.ArgumentParser(description="コエコミの同時アクセス負荷テスト")
    parser.add_argument("api", help="バックエンドのURL（例: https://xxx.trycloudflare.com）")
    parser.add_argument("--token", default="", help="EVENT_TOKEN")
    parser.add_argument("--children", type=int, default=10, help="同時に始める人数（既定10）")
    parser.add_argument("--lines", type=int, default=len(DEFAULT_LINES), help="1人あたりのセリフ数")
    args = parser.parse_args()

    api = args.api.rstrip("/")
    lines = [DEFAULT_LINES[i % len(DEFAULT_LINES)] for i in range(args.lines)]

    print(f"== コエコミ 負荷テスト: {args.children}人同時 × {len(lines)}セリフ")
    print(f"== API: {api}")

    try:
        health = get_json(f"{api}/health", args.token, timeout=15)
    except Exception as e:  # noqa: BLE001
        print(f"❌ /health に到達できません: {e}")
        return 1
    print(f"   状態={health.get('status')} 音声={health.get('ttsEffective')} workers={health.get('activeJobs', '?')}")
    if health.get("status") != "ok":
        print("   ⚠️ まだ準備中です。ウォームアップの完了を待ってください。")
    if health.get("ttsEffective") == "dummy":
        print("   ⚠️ dummy TTS です。本番の待ち時間は測れません（経路の確認のみ）。")

    audio = make_reference_wav()
    print(f"   参照音声: {len(audio) / 1024:.0f} KB")
    print(f"\n{args.children}人が同時に始めます…\n")

    sampler = Sampler(api=api, token=args.token)
    sampler.start()
    started = time.time()

    # 「授業開始の合図で全員が同時に押す」を再現する。
    with ThreadPoolExecutor(max_workers=args.children) as pool:
        futures = [pool.submit(run_child, i, api, args.token, lines, audio) for i in range(args.children)]
        results = []
        for f in futures:
            r = f.result()
            results.append(r)
            mark = "✅" if r.error is None else "❌"
            print(f"  {mark} #{r.index:2d}  {r.total_sec:6.1f}秒  {r.ok_lines}/{r.lines}行" + (f"  {r.error}" if r.error else ""))

    wall = time.time() - started
    sampler.stop()

    passed = report(results, sampler.depths, wall, len(lines))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
