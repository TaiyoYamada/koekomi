"""POST /generate-comic-voices — 4コマ分のAI音声を生成する。

受け取るもの:
- audio          : 録音音声（声の参照）
- reference_text : 参照テキスト（録音内容の文字起こし）
- line1..line4   : 各コマのセリフ

generation_lock を取得してから処理するので、
1つのColabでは音声生成が同時に複数走らない（1件ずつ順番に処理）。
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, File, Form, UploadFile

from ..locks import generation_lock
from ..services.audio import convert_to_wav, save_upload
from ..services.tts import synthesize_lines

log = logging.getLogger("vct.routes.generate")
router = APIRouter()


@router.post("/generate-comic-voices")
async def generate_comic_voices(
    audio: UploadFile = File(...),
    reference_text: str = Form(""),
    line1: str = Form(""),
    line2: str = Form(""),
    line3: str = Form(""),
    line4: str = Form(""),
) -> dict:
    data = await audio.read()
    suffix = Path(audio.filename or "ref").suffix or ".webm"
    src = save_upload(data, suffix=suffix)
    ref_wav = convert_to_wav(src)
    lines = [line1, line2, line3, line4]

    # 1つのColabにつき生成は1件ずつ。混雑時は順番待ちになる。
    async with generation_lock:
        log.info("音声生成を開始: %d 件", len(lines))
        files = await synthesize_lines(
            reference_audio=ref_wav,
            reference_text=reference_text,
            lines=lines,
        )
        log.info("音声生成が完了: %s", files)

    return {"files": files}
