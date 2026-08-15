"""POST /voices — 参照音声を1回だけ預けて VoiceId をもらう。

以前は生成のたびに参照音声を送っていた（お試し2回＋本番1回で計3回）。
ここで1回に減らすのが、レイテンシと帯域の両方に一番効く。
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from ..container import Container
from ..deps import get_container
from ..security import require_token

log = logging.getLogger("koekomi.routes.voices")
router = APIRouter(dependencies=[Depends(require_token)])

# 参照音声の上限。10秒の録音なら余裕で収まる。
MAX_REFERENCE_BYTES = 20 * 1024 * 1024


@router.post("/voices", status_code=status.HTTP_201_CREATED)
async def enroll_voice(
    c: Container = Depends(get_container),
    audio: UploadFile = File(...),
    reference_text: str = Form(""),
) -> dict:
    raw = await audio.read()
    if not raw:
        raise HTTPException(status_code=400, detail="音声が空です。")
    if len(raw) > MAX_REFERENCE_BYTES:
        raise HTTPException(status_code=413, detail="録音が大きすぎます。")

    suffix = Path(audio.filename or "ref").suffix or ".webm"
    try:
        voice_id = c.voices.enroll(raw, suffix, reference_text)
    except Exception as e:
        log.exception("声の登録に失敗しました")
        raise HTTPException(status_code=500, detail="声を覚えられませんでした。") from e

    return {"voiceId": voice_id, "expiresSec": c.voices.ttl_sec}


@router.delete("/voices/{voice_id}")
async def forget_voice(voice_id: str, c: Container = Depends(get_container)) -> dict:
    """明示的に忘れさせる（次の子に交代するとき）。参照音声のファイルも消える。"""
    return {"removed": c.voices.forget(voice_id)}
