"""ダミーTTS。QwenTTS を入れる前の動作確認用。

本物の音声合成はせず、セリフごとに「長さ・高さの違うトーン音」の wav を作る。
これにより、フロントの「4コマ劇場」がコマごとに違う音で再生され、
React → FastAPI → 音声ファイル返却 → 再生 の一連の流れを確認できる。
"""

from __future__ import annotations

import math
import struct
import wave
from pathlib import Path

_SAMPLE_RATE = 16000


def _write_tone_wav(out_path: Path, freq: float, seconds: float) -> None:
    n = int(_SAMPLE_RATE * seconds)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out_path), "w") as w:
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


class DummyTTS:
    name = "dummy"

    # コマ順で高さを変える（呼び出し側が _index を渡す想定）
    _base_freqs = [330.0, 392.0, 440.0, 523.0]
    _counter = 0

    async def synthesize(
        self,
        *,
        reference_audio: Path,
        reference_text: str,
        text: str,
        out_path: Path,
    ) -> Path:
        # セリフの長さに応じて再生時間を変える（最低 0.8 秒）。
        seconds = max(0.8, min(4.0, len(text) * 0.18))
        freq = self._base_freqs[self._counter % len(self._base_freqs)]
        self._counter += 1
        wav_path = out_path.with_suffix(".wav")
        _write_tone_wav(wav_path, freq, seconds)
        return wav_path
