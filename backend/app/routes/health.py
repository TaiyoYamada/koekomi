"""GET /health — 生存確認。フロントの接続確認に使う。"""

from __future__ import annotations

from fastapi import APIRouter

from ..config import settings
from ..locks import generation_lock

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "serverId": settings.server_id,
        "color": settings.server_color,
        "label": settings.server_label,
        "transcribeBackend": settings.transcribe_backend,
        "ttsBackend": settings.tts_backend,
        # 生成中かどうか（管理用の参考情報）
        "busy": generation_lock.locked(),
    }
