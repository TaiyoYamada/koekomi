#!/usr/bin/env python3
"""FastAPI アプリから OpenAPI スキーマを書き出す。

サーバーを起動せずにアプリを組み立てて `app.openapi()` を取るだけ。
`scripts/gen-api-types.sh` から呼ばれ、フロントの型の元になる。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.interface.http import create_app  # noqa: E402
from app.settings import Settings  # noqa: E402


def main() -> int:
    if len(sys.argv) < 2:
        print("使い方: dump_openapi.py <出力先.json>", file=sys.stderr)
        return 1
    out = Path(sys.argv[1])
    # dummy で組み立てる（GPU も依存も要らない。スキーマは同じ）。
    app = create_app(Settings(tts_backend="dummy"))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"  → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
