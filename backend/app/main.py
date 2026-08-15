"""エントリポイント。`uvicorn app.main:app` で起動する。

中身は組み立てを呼ぶだけ。実際の構成は interface/container.py にある。
"""

from __future__ import annotations

import logging

from .interface.http import create_app

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)

app = create_app()
