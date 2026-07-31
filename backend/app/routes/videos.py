"""POST /upload-video — 書き出した動画を一時保存する（QRコードで別端末に渡す用）。

iPad で書き出した動画（mp4 / webm）を受け取り、推測できないファイル名で
output に置く。ダウンロードは既存の GET /files/{filename} をそのまま使う。

子どもの声が入った動画なので、TTL（既定30分）を過ぎたら自動で削除する。
GPUを使わないただのファイルI/Oなので generation_lock は取らない。
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..config import settings

log = logging.getLogger("vct.routes.videos")
router = APIRouter()

ALLOWED_EXT = {".mp4", ".webm"}

# TTL削除タスクの参照を保持する（GCで消えて削除がキャンセルされないように）。
_delete_tasks: set[asyncio.Task] = set()


async def _delete_after(path: Path, ttl_sec: int) -> None:
    await asyncio.sleep(ttl_sec)
    try:
        path.unlink(missing_ok=True)
        log.info("TTL経過のため動画を削除: %s", path.name)
    except OSError as e:
        log.warning("動画の自動削除に失敗: %s (%s)", path, e)


@router.post("/upload-video")
async def upload_video(video: UploadFile = File(...)) -> dict:
    suffix = Path(video.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail="mp4 / webm のみアップロードできます")

    data = await video.read()
    if len(data) > settings.video_max_mb * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail=f"動画が大きすぎます（{settings.video_max_mb}MB まで）",
        )

    settings.ensure_dirs()
    # ファイル名は推測不能な uuid（URLを知らない人が引けないように）。
    name = f"video-{uuid.uuid4().hex}{suffix}"
    path = settings.output_dir / name
    path.write_bytes(data)
    log.info("動画を一時保存: %s (%.1f MB, TTL %d 秒)", name, len(data) / 1024 / 1024, settings.video_ttl_sec)

    task = asyncio.create_task(_delete_after(path, settings.video_ttl_sec))
    _delete_tasks.add(task)
    task.add_done_callback(_delete_tasks.discard)

    return {"filename": name, "expiresSec": settings.video_ttl_sec}
