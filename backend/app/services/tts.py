"""TTS（音声生成）サービス層。設定に応じて adapter を選ぶ。"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path

from ..adapters.base import TTSAdapter
from ..adapters.dummy_tts import DummyTTS
from ..config import settings

log = logging.getLogger("vct.tts")

_adapter: TTSAdapter | None = None


def get_tts() -> TTSAdapter:
    """設定 TTS_BACKEND に応じた TTSAdapter を返す（生成は1回だけ）。"""
    global _adapter
    if _adapter is not None:
        return _adapter

    backend = settings.tts_backend.lower()
    if backend == "qwen":
        from ..adapters.qwen_tts import QwenTTS

        _adapter = QwenTTS()
    else:
        if backend != "dummy":
            log.warning("不明な TTS_BACKEND=%s。dummy を使います。", backend)
        _adapter = DummyTTS()

    log.info("TTS adapter: %s", _adapter.name)
    return _adapter


async def synthesize_lines(
    *,
    reference_audio: Path,
    reference_text: str,
    lines: list[str],
) -> list[str]:
    """
    4つ（など）のセリフを順番に音声化し、出力ファイル名のリストを返す。

    呼び出し側（route）が generation_lock を保持しているため、
    1つのColab内では同時に複数の生成が走らないことが保証される。
    """
    settings.ensure_dirs()
    adapter = get_tts()
    batch = uuid.uuid4().hex[:8]
    filenames: list[str] = []

    for idx, text in enumerate(lines):
        out_path = settings.output_dir / f"voice-{batch}-{idx + 1}"
        written = await adapter.synthesize(
            reference_audio=reference_audio,
            reference_text=reference_text,
            text=text,
            out_path=out_path,
        )
        filenames.append(written.name)

    return filenames
