"""テスト共通のフィクスチャ。

Container を丸ごと差し替えられるようになったので、グローバルを
書き換えて回す必要が無くなった（設定はコンストラクタで注入する）。
"""

from __future__ import annotations

import io
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.interface.http import create_app
from app.settings import Settings

TEST_TOKEN = "test-token"


def make_settings(tmp_path: Path, **overrides) -> Settings:
    base = {
        "tts_backend": "dummy",
        "workers": 1,
        "artifact_dir": tmp_path / "artifacts",
        "tmp_dir": tmp_path / "tmp",
        "cache_dir": tmp_path / "cache",
        "event_token": TEST_TOKEN,
        "cors_origins": "http://localhost:5173",
        "server_id": "test-server",
    }
    base.update(overrides)
    return Settings(**base)


@pytest.fixture()
def settings(tmp_path: Path) -> Settings:
    return make_settings(tmp_path)


@pytest.fixture()
def client(settings: Settings):
    """認証ヘッダーを既定で付けた TestClient。"""
    app = create_app(settings)
    with TestClient(app) as c:
        c.headers.update({"X-Event-Token": TEST_TOKEN})
        yield c


@pytest.fixture()
def anon_client(settings: Settings):
    """認証ヘッダーを付けない TestClient（401 の確認用）。"""
    app = create_app(settings)
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def fake_audio() -> bytes:
    """ダミーの参照音声（wav として妥当な最小限のもの）。"""
    buf = io.BytesIO()
    with wave.open(buf, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * 16000)
    return buf.getvalue()


def enroll(client: TestClient, audio: bytes) -> str:
    res = client.post(
        "/voices",
        files={"audio": ("ref.wav", audio, "audio/wav")},
        data={"reference_text": "こんにちは"},
    )
    assert res.status_code == 201, res.text
    return res.json()["voiceId"]


def wait_for_job(client: TestClient, job_id: str, timeout: float = 20.0) -> dict:
    """ジョブが終わるまでポーリングする（クライアントと同じ待ち方）。"""
    import time

    deadline = time.time() + timeout
    body: dict = {}
    while time.time() < deadline:
        res = client.get(f"/jobs/{job_id}")
        assert res.status_code == 200, res.text
        body = res.json()
        if body["state"] in ("done", "failed", "cancelled"):
            return body
        time.sleep(0.05)
    raise AssertionError(f"ジョブが終わりませんでした: {body}")
