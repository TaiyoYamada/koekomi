"""GET /health — 生存確認。フロントの接続確認に使う。"""

from __future__ import annotations

from fastapi import APIRouter

from ..config import settings
from ..locks import generation_lock
from ..services.tts import get_tts, tts_fallback_reason

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "serverId": settings.server_id,
        "color": settings.server_color,
        "label": settings.server_label,
        # 設定値（こう動かしたい）
        "ttsBackend": settings.tts_backend,
        # 実際に動いているもの（dummy ならフォールバック中）
        "ttsEffective": get_tts().name,
        # フォールバックした理由（None なら正常）
        "ttsFallback": tts_fallback_reason(),
        # 生成中かどうか（管理用の参考情報）
        "busy": generation_lock.locked(),
    }
