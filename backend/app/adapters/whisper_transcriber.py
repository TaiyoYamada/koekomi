"""Whisper による文字起こし（本実装の差し替え先）。

requirements.txt の openai-whisper か faster-whisper を有効にし、
.env で TRANSCRIBE_BACKEND=whisper にすると使われる。

モデルのロードは重いので、最初の1回だけ行い使い回す。
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from ..config import settings

log = logging.getLogger("vct.whisper")


class WhisperTranscriber:
    name = "whisper"

    def __init__(self) -> None:
        self._model = None

    def _load(self):
        if self._model is not None:
            return self._model
        # openai-whisper を使う例。faster-whisper に変えてもよい。
        import whisper  # type: ignore

        log.info("Whisper モデルをロード中: %s", settings.whisper_model)
        self._model = whisper.load_model(settings.whisper_model)
        return self._model

    async def transcribe(self, wav_path: Path) -> str:
        # CPU/GPU を専有するブロッキング処理なのでスレッドに逃がす。
        def _run() -> str:
            model = self._load()
            result = model.transcribe(str(wav_path), language="ja")
            return str(result.get("text", "")).strip()

        return await asyncio.to_thread(_run)
