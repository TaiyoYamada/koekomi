"""文字起こしサービス層。設定に応じて adapter を選ぶ。"""

from __future__ import annotations

import logging
from pathlib import Path

from ..adapters.base import Transcriber
from ..adapters.dummy_transcriber import DummyTranscriber
from ..config import settings

log = logging.getLogger("vct.transcription")

_transcriber: Transcriber | None = None


def get_transcriber() -> Transcriber:
    """設定 TRANSCRIBE_BACKEND に応じた Transcriber を返す（生成は1回だけ）。"""
    global _transcriber
    if _transcriber is not None:
        return _transcriber

    backend = settings.transcribe_backend.lower()
    if backend == "whisper":
        from ..adapters.whisper_transcriber import WhisperTranscriber

        _transcriber = WhisperTranscriber()
    else:
        if backend != "dummy":
            log.warning("不明な TRANSCRIBE_BACKEND=%s。dummy を使います。", backend)
        _transcriber = DummyTranscriber()

    log.info("Transcriber: %s", _transcriber.name)
    return _transcriber


async def transcribe_wav(wav_path: Path) -> str:
    return await get_transcriber().transcribe(wav_path)
