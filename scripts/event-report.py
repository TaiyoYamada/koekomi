#!/usr/bin/env python3
"""イベント後のふりかえりレポート。

構造化ログ（`LOG_FORMAT=json` で起動したときの出力）を読み、
**次回の設計に使える数字**を出す。

    python3 scripts/event-report.py colab-1.log colab-2.log colab-3.log

出るもの:
  - 何人が使ったか（声の登録数）
  - 1行あたりの生成時間の分布 → 次回の台数の見積もり
  - ジョブの成功率・失敗した行の理由
  - 動画を何本作ったか

**子どもの声もセリフの本文も、ログにも出力にも出さない。** 集計に要る数字だけ。

ログの取り方（Colab のセルで）:

    os.environ["LOG_FORMAT"] = "json"
    %run colab/colab_runner.py 2>&1 | tee /content/colab-1.log
"""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import sys
from collections import Counter
from pathlib import Path

# 構造化ログでない行（uvicorn の起動メッセージ等）も混ざるので、
# JSON として読めた行だけ拾う。
JOB_DONE = re.compile(r"ジョブが完了しました: job=(\w+) state=(\w+) ok=(\d+)/(\d+)")
LINE_FAIL = re.compile(r"行の生成に失敗: job=(\w+) line=(\d+) \((.*)\)")
VOICE_ADD = re.compile(r"声を登録しました")
RENDER_OK = re.compile(r"レンダリング完了")


def read_lines(paths: list[Path]) -> list[dict]:
    records: list[dict] = []
    for path in paths:
        if not path.is_file():
            print(f"⚠️ 読めません: {path}", file=sys.stderr)
            continue
        for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
            raw = raw.strip()
            if not raw:
                continue
            if raw.startswith("{"):
                try:
                    records.append(json.loads(raw))
                    continue
                except json.JSONDecodeError:
                    pass
            # テキスト形式のログも拾えるようにしておく（json にし忘れたとき用）。
            records.append({"msg": raw, "logger": "?", "level": "INFO"})
    return records


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * p
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    return ordered[lo] if lo == hi else ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def main() -> int:
    parser = argparse.ArgumentParser(description="イベント後のふりかえりレポート")
    parser.add_argument("logs", nargs="+", type=Path, help="各サーバーのログ")
    args = parser.parse_args()

    records = read_lines(args.logs)
    if not records:
        print("ログが読めませんでした。")
        return 1

    voices = 0
    jobs_done = 0
    jobs_partial = 0
    lines_ok = 0
    lines_total = 0
    renders = 0
    failures: Counter[str] = Counter()
    line_seconds: list[float] = []

    for r in records:
        msg = str(r.get("msg", ""))

        if VOICE_ADD.search(msg):
            voices += 1
        if RENDER_OK.search(msg):
            renders += 1

        m = JOB_DONE.search(msg)
        if m:
            jobs_done += 1
            ok, total = int(m.group(3)), int(m.group(4))
            lines_ok += ok
            lines_total += total
            if ok < total:
                jobs_partial += 1

        m = LINE_FAIL.search(msg)
        if m:
            failures[m.group(3)[:60]] += 1

        # 構造化ログで秒数を入れている場合はそれを使う。
        sec = r.get("lineSec") or r.get("sec")
        if isinstance(sec, (int, float)) and 0 < sec < 600:
            line_seconds.append(float(sec))

    print()
    print("=" * 60)
    print(" コエコミ イベントふりかえり")
    print("=" * 60)
    print(f"  読んだログ            : {len(args.logs)} ファイル / {len(records)} 行")
    print()
    print(f"  声を登録した回数      : {voices}")
    print("    （子どもの人数の目安。録り直すと増えます）")
    print(f"  完了したジョブ        : {jobs_done}")
    print(f"  作った行              : {lines_ok}/{lines_total}")
    if lines_total:
        print(f"  成功率                : {lines_ok / lines_total * 100:.1f}%")
    print(f"  部分的に失敗したジョブ: {jobs_partial}")
    print(f"  作った動画            : {renders}")

    if line_seconds:
        print()
        print("  1行あたりの生成時間")
        print(
            f"    p50 {percentile(line_seconds, 0.5):.2f}秒   "
            f"p90 {percentile(line_seconds, 0.9):.2f}秒   "
            f"最大 {max(line_seconds):.2f}秒"
        )
        print(f"    平均 {statistics.mean(line_seconds):.2f}秒（{len(line_seconds)}件）")
        print()
        print("  → 次回の見積もり: 人数 × セリフ数 × この秒数 ÷ 台数")
    else:
        print()
        print("  1行あたりの時間は測れませんでした。")
        print("  LOG_FORMAT=json で起動すると次回から集計できます。")

    if failures:
        print()
        print("  失敗した行の理由")
        for reason, count in failures.most_common(5):
            print(f"    {count:4d} × {reason}")

    print()
    print("  ⚠️ このレポートに子どもの声・セリフは含まれません。")
    print("     ログ自体もイベント後は削除してください。")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
