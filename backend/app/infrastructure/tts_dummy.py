"""ダミーTTS。GPU も重い依存も無い環境で全フローを動かすための実装。

本物の音声合成はせず、セリフごとに高さと長さの違うトーン音を返す。
「録音 → 生成 → 劇場再生 → 動画書き出し」までを、ノートPC1台で
最後まで確認できることに価値がある。CI もこの実装でAPIを検証する。
"""

from __future__ import annotations

import io
import math
import struct
import threading
import wave
from dataclasses import dataclass, field
from pathlib import Path

_SAMPLE_RATE = 16000
# コマ順で高さを変える（どの行の音か耳で分かるように）。
_BASE_FREQS = (330.0, 392.0, 440.0, 523.0)


@dataclass
class DummyVoice:
    """ダミーの話者ハンドル。参照音声の長さで少しだけ声色を変える。"""

    reference_text: str
    seed: int
    counter: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def next_freq(self) -> float:
        with self.lock:
            i = self.counter
            self.counter += 1
        return _BASE_FREQS[(i + self.seed) % len(_BASE_FREQS)]


class DummyTTS:
    name = "dummy"

    def __init__(self) -> None:
        self._ready = True

    def enroll(self, wav: Path, reference_text: str) -> DummyVoice:
        # 参照音声のサイズを種にして、子どもごとに音の並びを変える。
        try:
            seed = wav.stat().st_size % len(_BASE_FREQS)
        except OSError:
            seed = 0
        return DummyVoice(reference_text=reference_text, seed=seed)

    def synthesize(self, handle: DummyVoice, text: str) -> bytes:
        # セリフの長さに応じて再生時間を変える（最低 0.8 秒）。
        seconds = max(0.8, min(4.0, len(text) * 0.18))
        return _tone_wav_bytes(handle.next_freq(), seconds)

    def warmup(self) -> None:
        return None

    def is_ready(self) -> bool:
        return self._ready


def _tone_wav_bytes(freq: float, seconds: float) -> bytes:
    n = int(_SAMPLE_RATE * seconds)
    buf = io.BytesIO()
    with wave.open(buf, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)  # 16bit
        w.setframerate(_SAMPLE_RATE)
        frames = bytearray()
        for i in range(n):
            # フェードイン・アウトで耳に優しく
            env = min(1.0, i / 800, (n - i) / 800)
            sample = int(0.35 * env * 32767 * math.sin(2 * math.pi * freq * i / _SAMPLE_RATE))
            frames += struct.pack("<h", sample)
        w.writeframes(bytes(frames))
    return buf.getvalue()
