"""ログの整え方。

■ なぜ構造化するか
    いまのログは人が読む前提のテキストで、**あとから集計できない**。
    イベントが終わったあとに知りたいのは、次のような数字:

      - 1行あたり何秒かかったか（次回の台数の見積もり）
      - 何人が何秒待ったか
      - どの行が失敗したか、その理由は

    1行1JSONにしておけば、`scripts/event-report.py` で集計できる。
    研究発表の材料にもなる。

■ 何を出さないか
    **子どもの声も、セリフの本文も出さない。** ログは Colab のセルや
    ファイルに残り、消し忘れる。長さや件数など、集計に要る数字だけにする。
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from typing import Any


class JsonFormatter(logging.Formatter):
    """1行1JSON。人が読むときは `jq` を通す前提。"""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": round(record.created, 3),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        # `log.info("...", extra={"event": {...}})` で数値を足せる。
        event = getattr(record, "event", None)
        if isinstance(event, dict):
            payload |= event
        if record.exc_info:
            payload["error"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def setup_logging() -> None:
    """`LOG_FORMAT=json` なら構造化、それ以外は人が読む形。

    ふだんの開発は読みやすさ優先。イベント本番だけ json にして、
    あとから集計できるようにする。
    """
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    handler = logging.StreamHandler(sys.stdout)

    if os.getenv("LOG_FORMAT", "text").lower() == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s"))

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # uvicorn のアクセスログは冗長なので落とす（/health を毎秒叩かれる）。
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


class Timer:
    """経過時間を測ってログに残す。

    with Timer() as t:
        ...
    log.info("できた", extra={"event": {"sec": t.seconds}})
    """

    def __init__(self) -> None:
        self._start = 0.0
        self.seconds = 0.0

    def __enter__(self) -> Timer:
        self._start = time.perf_counter()
        return self

    def __exit__(self, *exc: object) -> None:
        self.seconds = round(time.perf_counter() - self._start, 3)
