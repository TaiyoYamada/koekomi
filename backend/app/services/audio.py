"""音声ファイルの扱い（ffmpeg での wav 変換など）。"""

from __future__ import annotations

import logging
import shutil
import subprocess
import uuid
from pathlib import Path

from ..config import settings

log = logging.getLogger("vct.audio")


def save_upload(data: bytes, suffix: str = ".bin") -> Path:
    """アップロードされたバイト列を tmp に保存し、パスを返す。"""
    settings.ensure_dirs()
    path = settings.tmp_dir / f"upload-{uuid.uuid4().hex}{suffix}"
    path.write_bytes(data)
    return path


def convert_to_wav(src: Path) -> Path:
    """
    任意の音声を TTS が扱いやすい wav (16kHz mono) に変換する。

    ffmpeg が無い・失敗した場合は元ファイルをそのまま返す（フローを止めない）。
    """
    settings.ensure_dirs()
    dst = settings.tmp_dir / f"{src.stem}-16k.wav"

    if shutil.which(settings.ffmpeg_bin) is None:
        log.warning("ffmpeg が見つかりません。変換をスキップします: %s", settings.ffmpeg_bin)
        return src

    cmd = [
        settings.ffmpeg_bin,
        "-y",
        "-i",
        str(src),
        "-ac",
        "1",  # モノラル
        "-ar",
        "16000",  # 16kHz
        "-f",
        "wav",
        str(dst),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        return dst
    except (subprocess.CalledProcessError, OSError) as e:
        log.warning("ffmpeg 変換に失敗しました。元ファイルを使用します: %s", e)
        return src
