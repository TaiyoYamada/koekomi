"""音声ファイルの扱い（ffmpeg での wav 変換など）。"""

from __future__ import annotations

import logging
import shutil
import subprocess
import uuid
import wave
from pathlib import Path

from ..config import settings

log = logging.getLogger("vct.audio")

# 参照音声の前後の無音を落とすフィルタ。
# 「録音スタート」を押してから読み始めるまでの間（と、読み終わってから止めるまでの間）が
# そのまま残っていると、声クローンがその「間」ごと真似して生成音声の頭に無音が入る。
# start_silence=0.1 で頭に 0.1 秒だけ残す（切り詰めすぎて語頭が欠けないように）。
_TRIM_ONE_SIDE = "silenceremove=start_periods=1:start_duration=0:start_threshold=-45dB:start_silence=0.1"
_TRIM_FILTER = f"{_TRIM_ONE_SIDE},areverse,{_TRIM_ONE_SIDE},areverse"

# 無音カット後がこれより短いなら、切りすぎ（または元がほぼ無音）とみなしてカット無しに戻す。
_MIN_TRIMMED_SEC = 1.0


def save_upload(data: bytes, suffix: str = ".bin") -> Path:
    """アップロードされたバイト列を tmp に保存し、パスを返す。"""
    settings.ensure_dirs()
    path = settings.tmp_dir / f"upload-{uuid.uuid4().hex}{suffix}"
    path.write_bytes(data)
    return path


def wav_duration_sec(path: Path) -> float:
    """wav の長さ（秒）。開けなければ 0.0。"""
    try:
        with wave.open(str(path), "r") as w:
            rate = w.getframerate()
            return w.getnframes() / rate if rate else 0.0
    except (wave.Error, OSError):
        return 0.0


def _run_ffmpeg(src: Path, dst: Path, audio_filter: str | None = None) -> bool:
    """16kHz モノラル wav に変換する。成功したら True。"""
    cmd = [settings.ffmpeg_bin, "-y", "-i", str(src), "-ac", "1", "-ar", "16000"]
    if audio_filter:
        cmd += ["-af", audio_filter]
    cmd += ["-f", "wav", str(dst)]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        return True
    except (subprocess.CalledProcessError, OSError) as e:
        log.warning("ffmpeg 変換に失敗しました: %s", e)
        return False


def convert_to_wav(src: Path, *, trim_silence: bool = False) -> Path:
    """
    任意の音声を TTS が扱いやすい wav (16kHz mono) に変換する。

    trim_silence=True なら前後の無音も落とす（声クローンの参照音声用）。
    ffmpeg が無い・失敗した場合は元ファイルをそのまま返す（フローを止めない）。
    """
    settings.ensure_dirs()
    dst = settings.tmp_dir / f"{src.stem}-16k.wav"

    if shutil.which(settings.ffmpeg_bin) is None:
        log.warning("ffmpeg が見つかりません。変換をスキップします: %s", settings.ffmpeg_bin)
        return src

    if trim_silence:
        trimmed = settings.tmp_dir / f"{src.stem}-16k-trim.wav"
        if _run_ffmpeg(src, trimmed, _TRIM_FILTER):
            sec = wav_duration_sec(trimmed)
            if sec >= _MIN_TRIMMED_SEC:
                log.info("参照音声の無音をカットしました: %.1f 秒", sec)
                return trimmed
            log.warning("無音カット後が短すぎます（%.1f 秒）。カット無しで変換します。", sec)
        trimmed.unlink(missing_ok=True)

    if _run_ffmpeg(src, dst):
        return dst
    log.warning("元ファイルをそのまま使用します: %s", src)
    return src
