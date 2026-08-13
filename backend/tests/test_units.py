"""サービス層・adapter 層の単体テスト。"""

from __future__ import annotations

import math
import shutil
import struct
import wave
from pathlib import Path

import pytest

from app.adapters.dummy_tts import DummyTTS
from app.config import settings
from app.services.audio import convert_to_wav, wav_duration_sec
from app.services.tts import get_tts


def run_async(coro):
    import asyncio

    return asyncio.run(coro)


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


def test_service_falls_back_to_dummy_without_ai_deps():
    # 既定は qwen だが、torch・qwen-tts が無い環境
    # （CI やローカル開発）では dummy にフォールバックして落ちないこと。
    assert get_tts().name == "dummy"


# ===== 無音カット（生成音声の頭に空白を入れないための処理）=====


def _write_wav(path: Path, silence_sec: float, tone_sec: float, rate: int = 16000) -> None:
    """先頭に無音、そのあとにトーンが入った wav を作る（録音の頭の「間」を模す）。"""
    with wave.open(str(path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        frames += b"\x00\x00" * int(rate * silence_sec)
        for i in range(int(rate * tone_sec)):
            frames += struct.pack("<h", int(0.6 * 32767 * math.sin(2 * math.pi * 440 * i / rate)))
        w.writeframes(bytes(frames))


def test_wav_duration_sec(tmp_path: Path):
    p = tmp_path / "a.wav"
    _write_wav(p, silence_sec=0.5, tone_sec=1.5)
    assert wav_duration_sec(p) == pytest.approx(2.0, abs=0.01)
    # 壊れたファイル・無いファイルは 0.0（呼び出し側の判定を止めない）。
    assert wav_duration_sec(tmp_path / "none.wav") == 0.0


def test_convert_to_wav_returns_source_without_ffmpeg(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "tmp_dir", tmp_path / "tmp")
    monkeypatch.setattr(settings, "ffmpeg_bin", "ffmpeg-does-not-exist")
    src = tmp_path / "ref.wav"
    _write_wav(src, silence_sec=0.2, tone_sec=1.0)
    assert convert_to_wav(src, trim_silence=True) == src


@pytest.mark.skipif(shutil.which(settings.ffmpeg_bin) is None, reason="ffmpeg が無い環境ではスキップ")
def test_convert_to_wav_trims_leading_silence(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "tmp_dir", tmp_path / "tmp")
    src = tmp_path / "ref.wav"
    _write_wav(src, silence_sec=2.0, tone_sec=3.0)

    trimmed = convert_to_wav(src, trim_silence=True)
    # 頭の無音（2秒）が落ちて、声のぶん（3秒）＋わずかな余白だけが残る。
    assert wav_duration_sec(trimmed) == pytest.approx(3.0, abs=0.3)

    # カットしない場合は元の長さのまま。
    plain = convert_to_wav(src)
    assert wav_duration_sec(plain) == pytest.approx(5.0, abs=0.1)


@pytest.mark.skipif(shutil.which(settings.ffmpeg_bin) is None, reason="ffmpeg が無い環境ではスキップ")
def test_convert_to_wav_keeps_audio_when_almost_silent(tmp_path: Path, monkeypatch):
    """ほぼ無音の録音を、カットしすぎて空にしてしまわないこと。"""
    monkeypatch.setattr(settings, "tmp_dir", tmp_path / "tmp")
    src = tmp_path / "quiet.wav"
    _write_wav(src, silence_sec=3.0, tone_sec=0.0)

    out = convert_to_wav(src, trim_silence=True)
    assert wav_duration_sec(out) == pytest.approx(3.0, abs=0.1)


def test_trim_silence_cuts_head_and_keeps_voice():
    np = pytest.importorskip("numpy")  # numpy は AI 環境（Colab）だけに入る
    from app.adapters.qwen_tts import _trim_silence

    sr = 24000
    silence = np.zeros(int(sr * 0.8), dtype="float32")
    tone = (0.5 * np.sin(2 * np.pi * 440 * np.arange(sr) / sr)).astype("float32")
    out = _trim_silence(np.concatenate([silence, tone, silence]), sr)

    # 声の長さ（1秒）＋前後に残す余白（0.05秒ずつ）程度に収まる。
    assert len(out) == pytest.approx(sr * 1.1, rel=0.05)
    assert float(np.max(np.abs(out))) == pytest.approx(0.5, abs=0.01)


def test_trim_silence_keeps_all_silent_input():
    np = pytest.importorskip("numpy")
    from app.adapters.qwen_tts import _trim_silence

    silent = np.zeros(1000, dtype="float32")
    assert len(_trim_silence(silent, 24000)) == 1000
