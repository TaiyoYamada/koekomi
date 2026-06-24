"""adapter 層のインターフェース定義。

実装を差し替えやすいように、文字起こし・TTS をそれぞれ Protocol で抽象化する。
- Transcriber: 録音音声 → テキスト
- TTSAdapter : 参照音声＋参照テキスト＋セリフ → 音声ファイル
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol, runtime_checkable


@runtime_checkable
class Transcriber(Protocol):
    name: str

    async def transcribe(self, wav_path: Path) -> str:
        """wav を文字起こししてテキストを返す。"""
        ...


@runtime_checkable
class TTSAdapter(Protocol):
    name: str

    async def synthesize(
        self,
        *,
        reference_audio: Path,
        reference_text: str,
        text: str,
        out_path: Path,
    ) -> Path:
        """
        参照音声・参照テキストを使って `text` を読み上げる音声を out_path に書き出す。

        戻り値は実際に書き出したファイルのパス（拡張子を変える実装もあるため）。
        """
        ...
