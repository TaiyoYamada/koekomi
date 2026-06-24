"""QwenTTS による音声生成（本実装の差し替え先）。

.env で TTS_BACKEND=qwen にすると使われる。
ここに QwenTTS（または互換の声クローン TTS）の実体を実装する。

ポイント:
- reference_audio / reference_text を使って声を真似る（voice cloning）。
- text をその声で読み上げ、out_path に wav として書き出す。
- モデルのロードは __init__ ではなく初回利用時に1回だけ行う。
- 重い処理は asyncio.to_thread でスレッドに逃がす
  （generation_lock により同時実行は1件に制限済み）。
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

log = logging.getLogger("vct.qwen")


class QwenTTS:
    name = "qwen"

    def __init__(self) -> None:
        self._model = None

    def _load(self):
        if self._model is not None:
            return self._model
        # TODO: QwenTTS のロード処理に差し替える。
        # 例:
        #   from transformers import AutoModel, AutoProcessor
        #   self._processor = AutoProcessor.from_pretrained("Qwen/Qwen-TTS-...")
        #   self._model = AutoModel.from_pretrained("Qwen/Qwen-TTS-...").to("cuda")
        raise NotImplementedError(
            "QwenTTS は未実装です。adapters/qwen_tts.py にモデルのロードと推論を実装してください。"
        )

    async def synthesize(
        self,
        *,
        reference_audio: Path,
        reference_text: str,
        text: str,
        out_path: Path,
    ) -> Path:
        def _run() -> Path:
            self._load()
            # TODO: 実際の推論。reference_audio/reference_text で声を真似て text を合成。
            #   wav = self._model.generate(text=text, ref_audio=..., ref_text=reference_text)
            #   import soundfile as sf
            #   sf.write(str(out_path.with_suffix(".wav")), wav, samplerate)
            raise NotImplementedError
            # return out_path.with_suffix(".wav")

        return await asyncio.to_thread(_run)
