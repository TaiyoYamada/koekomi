"""POST /cleanup — 出力・一時ファイルを片付ける。

イベントの合間や端末の切り替え時に、たまったファイルを削除する用途。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter

from ..config import settings

log = logging.getLogger("vct.routes.cleanup")
router = APIRouter()


@router.post("/cleanup")
async def cleanup() -> dict:
    removed = 0
    for d in (settings.output_dir, settings.tmp_dir):
        if not d.exists():
            continue
        for f in d.iterdir():
            if f.is_file():
                try:
                    f.unlink()
                    removed += 1
                except OSError as e:
                    log.warning("削除に失敗: %s (%s)", f, e)
    return {"removed": removed}
