"""POST /transcribe — 録音音声を受け取り、文字起こしする。

流れ: 受信 → tmp 保存 → ffmpeg で wav 変換 → Transcriber で文字起こし。
最初は DummyTranscriber、後で WhisperTranscriber に差し替え可能。
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, File, UploadFile

from ..services.audio import convert_to_wav, save_upload
from ..services.transcription import transcribe_wav

log = logging.getLogger("vct.routes.transcribe")
router = APIRouter()


@router.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)) -> dict:
    data = await audio.read()
    suffix = Path(audio.filename or "rec").suffix or ".webm"
    src = save_upload(data, suffix=suffix)
    wav = convert_to_wav(src)
    text = await transcribe_wav(wav)
    return {"text": text}
