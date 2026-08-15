"""ffmpeg による音声変換（参照音声の前処理）。

このモジュールが呼ばれるのは **子ども1人につき1回だけ** になった
（以前は生成リクエストのたびに呼ばれていた）。
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import uuid
import wave
from pathlib import Path

log = logging.getLogger("koekomi.audio")

# 参照音声の前後の無音を落とすフィルタ。
# 「録音スタート」を押してから読み始めるまでの間がそのまま残っていると、
# 声クローンがその「間」ごと真似して生成音声の頭に無音が入る。
# start_silence=0.1 で頭に 0.1 秒だけ残す（切り詰めすぎて語頭が欠けないように）。
_TRIM_ONE_SIDE = "silenceremove=start_periods=1:start_duration=0:start_threshold=-45dB:start_silence=0.1"
_TRIM_FILTER = f"{_TRIM_ONE_SIDE},areverse,{_TRIM_ONE_SIDE},areverse"

# 無音カット後がこれより短いなら、切りすぎ（または元がほぼ無音）とみなしてカット無しに戻す。
_MIN_TRIMMED_SEC = 1.0


def wav_duration_sec(path: Path) -> float:
    """wav の長さ（秒）。開けなければ 0.0。"""
    try:
        with wave.open(str(path), "r") as w:
            rate = w.getframerate()
            return w.getnframes() / rate if rate else 0.0
    except (wave.Error, OSError):
        return 0.0


class FfmpegAudioConverter:
    """AudioConverter ポートの実装。"""

    def __init__(self, *, tmp_dir: Path, ffmpeg_bin: str = "ffmpeg") -> None:
        self._tmp = tmp_dir
        self._bin = ffmpeg_bin

    def to_reference_wav(self, raw: bytes, suffix: str) -> Path:
        """アップロードされた音声を 16kHz モノラル wav にし、前後の無音を落とす。"""
        self._tmp.mkdir(parents=True, exist_ok=True)
        src = self._tmp / f"upload-{uuid.uuid4().hex}{suffix or '.bin'}"
        src.write_bytes(raw)
        try:
            return self._convert(src)
        finally:
            # 元のアップロードは変換後に用が無い。子どもの声を余分に残さない。
            try:
                src.unlink(missing_ok=True)
            except OSError:
                log.warning("アップロードの一時ファイルを削除できませんでした: %s", src)

    # ---- 内部 -------------------------------------------------------------

    def _convert(self, src: Path) -> Path:
        if shutil.which(self._bin) is None:
            log.warning("ffmpeg が見つかりません。変換をスキップします: %s", self._bin)
            # 消される src ではなく、残るコピーを返す。
            kept = self._tmp / f"ref-{uuid.uuid4().hex}{src.suffix}"
            kept.write_bytes(src.read_bytes())
            return kept

        stem = uuid.uuid4().hex
        trimmed = self._tmp / f"ref-{stem}-trim.wav"
        if self._run(src, trimmed, _TRIM_FILTER):
            sec = wav_duration_sec(trimmed)
            if sec >= _MIN_TRIMMED_SEC:
                log.info("参照音声の無音をカットしました: %.1f 秒", sec)
                return trimmed
            log.warning("無音カット後が短すぎます（%.1f 秒）。カット無しで変換します。", sec)
        trimmed.unlink(missing_ok=True)

        plain = self._tmp / f"ref-{stem}.wav"
        if self._run(src, plain):
            return plain

        log.warning("変換に失敗しました。元の音声をそのまま使います。")
        kept = self._tmp / f"ref-{stem}{src.suffix}"
        kept.write_bytes(src.read_bytes())
        return kept

    def _run(self, src: Path, dst: Path, audio_filter: str | None = None) -> bool:
        cmd = [self._bin, "-y", "-i", str(src), "-ac", "1", "-ar", "16000"]
        if audio_filter:
            cmd += ["-af", audio_filter]
        cmd += ["-f", "wav", str(dst)]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=120)
            return True
        except (subprocess.SubprocessError, OSError) as e:
            log.warning("ffmpeg 変換に失敗しました: %s", e)
            return False
