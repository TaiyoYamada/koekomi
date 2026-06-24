"""サービス層・adapter 層の単体テスト。"""

from __future__ import annotations

import wave
from pathlib import Path

from app.adapters.dummy_transcriber import DummyTranscriber
from app.adapters.dummy_tts import DummyTTS
from app.services.transcription import get_transcriber
from app.services.tts import get_tts


def run_async(coro):
    import asyncio

    return asyncio.run(coro)


def test_dummy_transcriber_returns_nonempty():
    t = DummyTranscriber()
    text = run_async(t.transcribe(Path("whatever.wav")))
    assert isinstance(text, str) and len(text) > 0


def test_dummy_tts_writes_valid_wav(tmp_path: Path):
    tts = DummyTTS()
    out = tmp_path / "voice-1"
    written = run_async(
        tts.synthesize(
            reference_audio=tmp_path / "ref.wav",
            reference_text="こんにちは",
            text="やあ、げんき？",
            out_path=out,
        )
    )
    assert written.suffix == ".wav"
    assert written.is_file()
    with wave.open(str(written), "r") as w:
        assert w.getframerate() == 16000
        assert w.getnframes() > 0


def test_dummy_tts_varies_length_with_text(tmp_path: Path):
    tts = DummyTTS()

    def frames(text: str, name: str) -> int:
        p = run_async(
            tts.synthesize(
                reference_audio=tmp_path / "r.wav",
                reference_text="",
                text=text,
                out_path=tmp_path / name,
            )
        )
        with wave.open(str(p), "r") as w:
            return w.getnframes()

    short = frames("あ", "a")
    long = frames("あいうえおかきくけこさしすせそ", "b")
    assert long > short


def test_service_selects_dummy_by_default():
    assert get_transcriber().name == "dummy"
    assert get_tts().name == "dummy"
