"""Qwen3-TTS による音声生成（声クローン）。

Qwen3-TTS は Apache-2.0 のオープンモデルで、参照音声3秒程度から声を真似て
（zero-shot voice clone）任意のテキストを読み上げられる。Colab の GPU 上で動かす。

  pip install -U qwen-tts            （backend/requirements-ai.txt）
  モデル: Qwen/Qwen3-TTS-12Hz-1.7B-Base（声クローン対応）

参照: https://github.com/QwenLM/Qwen3-TTS
      https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base

注意:
- モデルのロードは重いので初回利用時に1回だけ行い、使い回す。
- 重い処理は asyncio.to_thread に逃がす（generation_lock で同時実行は1件に制限済み）。
- GPU/依存が無い環境では service 層（services/tts.py）が dummy にフォールバックする。
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from ..config import settings

log = logging.getLogger("vct.qwen")

_SILENCE_SR = 24000


class QwenTTS:
    name = "qwen"

    def __init__(self) -> None:
        self._model = None

    def _load(self):
        if self._model is not None:
            return self._model
        import torch
        from qwen_tts import Qwen3TTSModel

        cuda = torch.cuda.is_available()
        kwargs: dict = {"device_map": "cuda:0" if cuda else "cpu"}
        if cuda:
            kwargs["dtype"] = torch.bfloat16
        # flash-attn があれば使う。無ければ sdpa（標準）にフォールバック（ビルド不要）。
        try:
            import flash_attn  # noqa: F401

            kwargs["attn_implementation"] = "flash_attention_2"
        except Exception:
            kwargs["attn_implementation"] = "sdpa"

        log.info(
            "Qwen3-TTS をロード中: %s (cuda=%s, attn=%s)",
            settings.qwen_model,
            cuda,
            kwargs["attn_implementation"],
        )
        self._model = Qwen3TTSModel.from_pretrained(settings.qwen_model, **kwargs)
        return self._model

    async def warmup(self) -> None:
        """モデルを先に読み込んでおく（初回リクエストの数分待ちを無くす）。"""
        await asyncio.to_thread(self._load)

    async def synthesize(
        self,
        *,
        reference_audio: Path,
        reference_text: str,
        text: str,
        out_path: Path,
    ) -> Path:
        def _run() -> Path:
            import soundfile as sf

            wav_path = out_path.with_suffix(".wav")

            # セリフが空のコマは無音にする（モデルに空文字を渡さない）。
            if not text.strip():
                import numpy as np

                sf.write(str(wav_path), np.zeros(int(_SILENCE_SR * 0.4), dtype="float32"), _SILENCE_SR)
                return wav_path

            model = self._load()
            wavs, sr = model.generate_voice_clone(
                text=text,
                language=settings.tts_language,
                ref_audio=str(reference_audio),
                ref_text=reference_text,
            )
            sf.write(str(wav_path), wavs[0], sr)
            return wav_path

        return await asyncio.to_thread(_run)
