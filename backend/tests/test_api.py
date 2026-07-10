"""API エンドポイントのテスト（ダミー実装ベース）。"""

from __future__ import annotations

from app.config import settings


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    # /health は「設定された」バックエンド名を返す（実効値ではなく構成値）。
    assert body["ttsBackend"] == settings.tts_backend
    assert body["busy"] is False


def test_generate_comic_voices_makes_one_file_per_line(client, fake_audio):
    # 可変個数のセリフ（同じキー 'lines' で複数送る）。
    res = client.post(
        "/generate-comic-voices",
        files={"audio": ("ref.webm", fake_audio, "audio/webm")},
        data={
            "reference_text": "こんにちは",
            "lines": ["やあ", "げんき？", "うん", "またね", "ばいばい"],
        },
    )
    assert res.status_code == 200
    files = res.json()["files"]
    assert len(files) == 5  # セリフの個数ぶん返る
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
        data={"reference_text": "x", "lines": ["a", "b", "c", "d"]},
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
        data={"reference_text": "x", "lines": ["a", "b", "c", "d"]},
    )
    # 処理後はロックが解放されている（1件ずつ処理の後始末）。
    assert generation_lock.locked() is False


def test_reference_recording_deleted_after_generation(client, fake_audio):
    """子どもの声（参照録音）はリクエスト処理後にサーバーへ残さない。"""
    from app.config import settings

    res = client.post(
        "/generate-comic-voices",
        files={"audio": ("ref.webm", fake_audio, "audio/webm")},
        data={"reference_text": "x", "lines": ["a", "b"]},
    )
    assert res.status_code == 200
    # tmp（アップロード置き場）に参照録音が残っていないこと。
    leftovers = list(settings.tmp_dir.iterdir())
    assert leftovers == [], f"参照録音が残っている: {leftovers}"
    # 生成した音声（再生に必要）は残っていること。
    assert any(settings.output_dir.iterdir())
