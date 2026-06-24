"""GET /files/{filename} — 生成済み音声ファイルを返す。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..config import settings

router = APIRouter()


@router.get("/files/{filename}")
async def get_file(filename: str) -> FileResponse:
    # パストラバーサル対策: ファイル名のみ許可する。
    safe = settings.output_dir / filename
    try:
        safe = safe.resolve()
        base = settings.output_dir.resolve()
        safe.relative_to(base)
    except (ValueError, OSError) as err:
        raise HTTPException(status_code=400, detail="invalid filename") from err

    if not safe.is_file():
        raise HTTPException(status_code=404, detail="not found")

    return FileResponse(str(safe))
