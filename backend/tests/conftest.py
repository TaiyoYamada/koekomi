"""テスト共通のフィクスチャ。"""

from __future__ import annotations

import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    """出力・一時ディレクトリをテスト用に差し替えた TestClient。"""
    settings.output_dir = tmp_path / "output"
    settings.tmp_dir = tmp_path / "tmp"
    settings.ensure_dirs()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def fake_audio() -> bytes:
    """ダミーの音声バイト列（中身は問わない。ダミー実装は内容を見ない）。"""
    return b"\x00\x01" * 256


def read_wav_frames(path: Path) -> int:
    """wav として開けてフレーム数を返す（壊れていれば例外）。"""
    with wave.open(str(path), "r") as w:
        return w.getnframes()
