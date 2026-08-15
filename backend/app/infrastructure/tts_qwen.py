"""Qwen3-TTS による声クローン。

参照: https://github.com/QwenLM/Qwen3-TTS

■ enroll / synthesize を分けたことで確実に得られるもの
    参照音声のアップロード・ffmpeg変換・ディスク書き込みが、
    子ども1人につき1回になる（以前は生成リクエストごとに3回）。

■ まだ得られていないもの（正直に書いておく）
    「話者条件付けの計算結果そのものを使い回す」ところまでは行っていない。
    qwen-tts が公開しているのは `generate_voice_clone(text, ref_audio, ref_text)`
    という一体型のAPIで、話者表現だけを取り出す口が見当たらないため。
    ポートの形（enroll が不透明なハンドルを返す）は既にそれに合わせてあるので、
    ライブラリ側に該当APIがあると分かったら `_Voice` に持たせて
    `synthesize` で渡すだけで済む。→ 下の TODO を参照。
    ここが埋まると1行あたりの生成時間がさらに縮む見込み。
"""

from __future__ import annotations

import io
import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger("koekomi.qwen")

_SILENCE_SR = 24000

# 生成音声の前後の無音を落とすしきい値。
# ピークに対する相対値（-34dB 相当）と絶対値の大きいほうを使い、
# 小さい声でも大きい声でも同じように効かせる。
_TRIM_REL = 0.02
_TRIM_ABS = 0.005
# 語頭・語尾が欠けないように、無音を少しだけ残す。
_TRIM_KEEP_SEC = 0.05


@dataclass
class _Voice:
    """話者ハンドル。"""

    wav_path: Path
    reference_text: str
    # TODO: qwen-tts が話者条件付けの抽出APIを公開したら、その結果をここに保持し、
    #       synthesize で渡す。ポートの形は既にそれを想定している。
    conditioning: Any | None = None


def dependencies_available() -> tuple[bool, str | None]:
    """torch と qwen_tts が import できるか。できない理由も返す。"""
    try:
        import torch  # noqa: F401
        from qwen_tts import Qwen3TTSModel  # noqa: F401
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"
    return True, None


class QwenTTS:
    name = "qwen"

    def __init__(self, *, model_name: str, language: str, serialize: bool = True) -> None:
        self._model_name = model_name
        self._language = language
        # 型を書かないと mypy が None 固定と見なし、読み込み後の分岐を
        # 「到達しないコード」と誤判定する。
        self._model: Any | None = None
        self._ready = False
        self._load_lock = threading.Lock()
        # GPU 推論はモデル実装がスレッドセーフとは限らない。既定は直列。
        # WORKERS を増やしても、ここが直列である限り GPU 並列度は 1 のまま。
        # 実測して安全だと確認できたら TTS_SERIALIZE=0 で外す。
        self._gpu_lock = threading.Lock() if serialize else None

    # ---- TTSPort ----------------------------------------------------------

    def enroll(self, wav: Path, reference_text: str) -> _Voice:
        return _Voice(wav_path=wav, reference_text=reference_text)

    def synthesize(self, handle: _Voice, text: str) -> bytes:
        import numpy as np
        import soundfile as sf

        # セリフが空なら無音を返す（モデルに空文字を渡さない）。
        if not text.strip():
            return _wav_bytes(np.zeros(int(_SILENCE_SR * 0.4), dtype="float32"), _SILENCE_SR)

        model = self._load()
        if self._gpu_lock is not None:
            with self._gpu_lock:
                wavs, sr = self._generate(model, handle, text)
        else:
            wavs, sr = self._generate(model, handle, text)

        # モデルが頭に付けがちな無音を落としてから返す
        # （再生でも動画書き出しでも、そのまま「最初の空白」になるため）。
        try:
            out = trim_silence(wavs[0], sr)
        except Exception as e:  # トリムは飾り。失敗しても音声は返す。
            log.warning("無音カットに失敗しました。そのまま保存します: %s", e)
            out = wavs[0]

        buf = io.BytesIO()
        sf.write(buf, out, sr, format="WAV")
        return buf.getvalue()

    def warmup(self) -> None:
        self._load()
        self._ready = True

    def is_ready(self) -> bool:
        return self._ready

    # ---- 内部 -------------------------------------------------------------

    def _generate(self, model: Any, handle: _Voice, text: str) -> tuple[Any, int]:
        return model.generate_voice_clone(
            text=text,
            language=self._language,
            ref_audio=str(handle.wav_path),
            ref_text=handle.reference_text,
        )

    def _load(self) -> Any:
        if self._model is not None:
            return self._model
        with self._load_lock:
            # ダブルチェックロッキング。ロックを待っている間に、別のスレッドが
            # 読み込みを終えていることがある（モデルの読み込みは数分かかるので、
            # ここを削ると全ワーカーが同じモデルを重複ロードして OOM になる）。
            # mypy は上の分岐で None に絞り込むため到達不能と判断するが、
            # 並行実行を表現できないだけで、この検査は必要。
            if self._model is not None:
                return self._model  # type: ignore[unreachable]
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
                self._model_name,
                cuda,
                kwargs["attn_implementation"],
            )
            self._model = Qwen3TTSModel.from_pretrained(self._model_name, **kwargs)
            self._ready = True
            return self._model


def trim_silence(wav: Any, sr: int) -> Any:
    """波形の前後の無音を落とす。全部が無音なら元のまま返す。"""
    import numpy as np

    arr = np.asarray(wav)
    # ステレオで返ってきた場合も先頭位置の判定はモノラルで行う。
    mono = arr if arr.ndim == 1 else arr.mean(axis=1)
    peak = float(np.max(np.abs(mono))) if mono.size else 0.0
    threshold = max(_TRIM_ABS, peak * _TRIM_REL)
    loud = np.flatnonzero(np.abs(mono) >= threshold)
    if loud.size == 0:
        return arr

    keep = int(sr * _TRIM_KEEP_SEC)
    start = max(0, int(loud[0]) - keep)
    end = min(mono.shape[0], int(loud[-1]) + 1 + keep)
    if start > 0:
        log.info("生成音声の先頭 %.2f 秒の無音をカットしました", start / sr)
    return arr[start:end]


def _wav_bytes(data: Any, sr: int) -> bytes:
    import soundfile as sf

    buf = io.BytesIO()
    sf.write(buf, data, sr, format="WAV")
    return buf.getvalue()
