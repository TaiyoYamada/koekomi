"""エントリポイント。`uvicorn app.main:app` で起動する。

中身は組み立てを呼ぶだけ。実際の構成は interface/container.py にある。
"""

from __future__ import annotations

from .infrastructure.logging_setup import setup_logging
from .interface.http import create_app

# ふだんは人が読む形。イベント本番は LOG_FORMAT=json にすると、
# あとから scripts/event-report.py で集計できる。
setup_logging()

app = create_app()
