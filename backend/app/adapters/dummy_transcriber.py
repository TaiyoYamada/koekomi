"""ダミー文字起こし。Whisper を入れる前の動作確認用。"""

from __future__ import annotations

from pathlib import Path


class DummyTranscriber:
    name = "dummy"

    async def transcribe(self, wav_path: Path) -> str:
        # 実際の音声内容は見ない。後で whisper_transcriber に差し替える。
        # 子どもが編集する前提なので、それらしいサンプル文を返す。
        return "こんにちは、わたしのなまえは○○です。"
