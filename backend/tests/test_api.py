"""API エンドポイントのテスト（ダミー実装ベース）。"""

from __future__ import annotations

from app.config import settings


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["transcribeBackend"] == "dummy"
    assert body["ttsBackend"] == "dummy"
    assert body["busy"] is False


def test_transcribe_returns_text(client, fake_audio):
    res = client.post(
        "/transcribe",
        files={"audio": ("rec.webm", fake_audio, "audio/webm")},
    )
    assert res.status_code == 200
    text = res.json()["text"]
    assert isinstance(text, str)
    assert len(text) > 0


def test_generate_comic_voices_makes_four_files(client, fake_audio):
    res = client.post(
        "/generate-comic-voices",
        files={"audio": ("ref.webm", fake_audio, "audio/webm")},
        data={
            "reference_text": "こんにちは",
            "line1": "やあ",
            "line2": "げんき？",
            "line3": "うん",
            "line4": "またね",
        },
    )
    assert res.status_code == 200
    files = res.json()["files"]
    assert len(files) == 4
    # 生成された各ファイルが /files から取得でき、wav として再生可能なこと。
    for name in files:
        assert name.endswith(".wav")
        got = client.get(f"/files/{name}")
        assert got.status_code == 200
        assert (settings.output_dir / name).is_file()


def test_files_404_for_missing(client):
    res = client.get("/files/does-not-exist.wav")
    assert res.status_code == 404


def test_files_blocks_path_traversal(client):
    # 出力ディレクトリの外を参照しようとしても弾かれる。
    res = client.get("/files/..%2f..%2fconfig.py")
    assert res.status_code in (400, 404)


def test_cleanup_removes_files(client, fake_audio):
    client.post(
        "/generate-comic-voices",
        files={"audio": ("ref.webm", fake_audio, "audio/webm")},
        data={"reference_text": "x", "line1": "a", "line2": "b", "line3": "c", "line4": "d"},
    )
    res = client.post("/cleanup")
    assert res.status_code == 200
    assert res.json()["removed"] >= 1
    # 出力ディレクトリが空になっている。
    assert not any(settings.output_dir.iterdir())


def test_generation_lock_released_after_request(client, fake_audio):
    from app.locks import generation_lock

    client.post(
        "/generate-comic-voices",
        files={"audio": ("ref.webm", fake_audio, "audio/webm")},
        data={"reference_text": "x", "line1": "a", "line2": "b", "line3": "c", "line4": "d"},
    )
    # 処理後はロックが解放されている（1件ずつ処理の後始末）。
    assert generation_lock.locked() is False
