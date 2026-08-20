"""API のテスト（ダミーTTSベース）。

正常系だけでなく、**このアプリの存在意義である障害パス**を意図的に踏む:
声の期限切れ、途中キャンセル、部分失敗、認証漏れ、期限切れ生成物。
"""

from __future__ import annotations

from .conftest import TEST_TOKEN, enroll, wait_for_job

# ---- 認証 -------------------------------------------------------------------


def test_health_is_public(anon_client):
    """/health だけは無認証で通す（接続できるかの確認そのものなので）。"""
    res = anon_client.get("/health")
    assert res.status_code == 200
    assert res.json()["serverId"] == "test-server"


def test_protected_endpoints_require_token(anon_client, fake_audio):
    """以前は全エンドポイントが無認証だった。今は 401 になること。"""
    assert anon_client.post("/jobs", json={"voiceId": "x", "lines": ["a"]}).status_code == 401
    assert anon_client.get("/artifacts/" + "0" * 32 + ".wav").status_code == 401
    assert anon_client.post("/cleanup").status_code == 401
    assert anon_client.get("/ops").status_code == 401
    res = anon_client.post("/voices", files={"audio": ("r.wav", fake_audio, "audio/wav")})
    assert res.status_code == 401


def test_token_accepted_via_query_param(anon_client, fake_audio):
    """<audio src> や QR のようにヘッダーを付けられない経路のため。"""
    res = anon_client.post(
        f"/voices?t={TEST_TOKEN}",
        files={"audio": ("ref.wav", fake_audio, "audio/wav")},
        data={"reference_text": "こんにちは"},
    )
    assert res.status_code == 201


def test_wrong_token_rejected(anon_client):
    assert anon_client.get("/ops?t=nope").status_code == 401


# ---- 声のエンロール ---------------------------------------------------------


def test_enroll_returns_voice_id(client, fake_audio):
    voice_id = enroll(client, fake_audio)
    assert len(voice_id) == 32


def test_enroll_rejects_empty_audio(client):
    res = client.post("/voices", files={"audio": ("ref.wav", b"", "audio/wav")})
    assert res.status_code == 400


def test_forget_voice_deletes_reference_file(client, fake_audio, settings):
    """子どもの声は明示的に消せる。ファイルの実体まで消えること。"""
    voice_id = enroll(client, fake_audio)
    assert any(settings.tmp_dir.iterdir())

    res = client.delete(f"/voices/{voice_id}")
    assert res.status_code == 200 and res.json()["removed"] is True

    leftovers = [p for p in settings.tmp_dir.iterdir() if p.is_file()]
    assert leftovers == [], f"参照音声が残っている: {leftovers}"


# ---- ジョブ -----------------------------------------------------------------


def test_job_produces_one_artifact_per_line(client, fake_audio):
    voice_id = enroll(client, fake_audio)
    lines = ["やあ", "げんき？", "うん", "またね", "ばいばい"]

    res = client.post("/jobs", json={"voiceId": voice_id, "lines": lines})
    assert res.status_code == 202
    job = res.json()
    assert job["total"] == len(lines)

    done = wait_for_job(client, job["jobId"])
    assert done["state"] == "done"
    assert done["finished"] == len(lines)

    # 行ごとに index が付いていて、順番が復元できること。
    indexes = [r["index"] for r in done["results"]]
    assert indexes == list(range(len(lines)))

    for r in done["results"]:
        assert r["artifactId"].endswith(".wav")
        got = client.get(f"/artifacts/{r['artifactId']}")
        assert got.status_code == 200
        assert got.headers["content-type"].startswith("audio/")


def test_job_rejects_unknown_voice(client):
    """積んでから失敗させず、受付時に弾く。"""
    res = client.post("/jobs", json={"voiceId": "0" * 32, "lines": ["a"]})
    assert res.status_code == 409


def test_job_rejects_empty_and_oversized(client, fake_audio):
    voice_id = enroll(client, fake_audio)
    assert client.post("/jobs", json={"voiceId": voice_id, "lines": []}).status_code == 400
    too_many = ["a"] * 1000
    assert client.post("/jobs", json={"voiceId": voice_id, "lines": too_many}).status_code == 400


def test_job_not_found(client):
    assert client.get("/jobs/does-not-exist").status_code == 404


def test_cancel_stops_remaining_lines(client, fake_audio):
    """キャンセルは協調的。走っている1行は終わるが、その先は処理されない。"""
    voice_id = enroll(client, fake_audio)
    res = client.post("/jobs", json={"voiceId": voice_id, "lines": ["あ"] * 40})
    job_id = res.json()["jobId"]

    assert client.post(f"/jobs/{job_id}/cancel").json()["cancelled"] is True
    done = wait_for_job(client, job_id)

    assert done["state"] == "cancelled"
    # 全行ぶんの結果は埋まる（未処理は cancelled として記録される）。
    assert done["finished"] == 40
    assert any(r["error"] == "cancelled" for r in done["results"])


def test_cancel_of_finished_job_is_noop(client, fake_audio):
    voice_id = enroll(client, fake_audio)
    job_id = client.post("/jobs", json={"voiceId": voice_id, "lines": ["あ"]}).json()["jobId"]
    wait_for_job(client, job_id)
    assert client.post(f"/jobs/{job_id}/cancel").json()["cancelled"] is False


def test_voice_expiry_fails_the_job_with_a_clear_message(client, fake_audio):
    """声が消えたあとに投げたジョブは、原因の分かるメッセージで失敗すること。"""
    voice_id = enroll(client, fake_audio)
    client.delete(f"/voices/{voice_id}")
    res = client.post("/jobs", json={"voiceId": voice_id, "lines": ["あ"]})
    assert res.status_code == 409
    assert "録音" in res.json()["detail"]


# ---- 生成物 -----------------------------------------------------------------


def test_artifact_id_is_validated(client):
    """パスを組み立てず、形式が合わないIDは即 404。"""
    for bad in ["../../etc/passwd", "..%2f..%2fsettings.py", "abc.wav", "0" * 32 + ".exe"]:
        assert client.get(f"/artifacts/{bad}").status_code in (404, 400)


def test_expired_artifact_is_gone(client, fake_audio, settings):
    """生成音声にも TTL が効くこと（以前は無期限に置きっぱなしだった）。"""
    import os
    import time

    voice_id = enroll(client, fake_audio)
    job_id = client.post("/jobs", json={"voiceId": voice_id, "lines": ["あ"]}).json()["jobId"]
    done = wait_for_job(client, job_id)
    artifact_id = done["results"][0]["artifactId"]

    path = settings.artifact_dir / artifact_id
    assert path.is_file()
    # mtime を TTL より過去にする（時間を待たずに期限切れを再現する）。
    old = time.time() - settings.artifact_ttl_sec - 10
    os.utime(path, (old, old))

    assert client.get(f"/artifacts/{artifact_id}").status_code == 404
    assert not path.exists(), "期限切れの生成物が残っている"


def test_upload_artifact_roundtrip(client):
    res = client.post(
        "/artifacts",
        files={"video": ("koekomi.mp4", b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64, "video/mp4")},
    )
    assert res.status_code == 201
    artifact_id = res.json()["artifactId"]
    assert artifact_id.endswith(".mp4")
    assert client.get(f"/artifacts/{artifact_id}").status_code == 200


def test_upload_artifact_rejects_bad_extension(client):
    res = client.post("/artifacts", files={"video": ("evil.exe", b"MZ", "application/octet-stream")})
    assert res.status_code == 400


# ---- 運用 -------------------------------------------------------------------


def test_ops_reports_state(client, fake_audio):
    enroll(client, fake_audio)
    body = client.get("/ops").json()
    assert body["tts"]["effective"] == "dummy"
    assert body["voices"]["enrolled"] == 1
    assert body["auth"]["tokenRequired"] is True
    assert body["auth"]["adminConfigured"] is True
    assert "artifactTtlSec" in body["retention"]


def test_cleanup_removes_voices_and_artifacts(admin_client, fake_audio, settings):
    voice_id = enroll(admin_client, fake_audio)
    job_id = admin_client.post("/jobs", json={"voiceId": voice_id, "lines": ["あ", "い"]}).json()["jobId"]
    wait_for_job(admin_client, job_id)

    res = admin_client.post("/cleanup")
    assert res.status_code == 200
    assert res.json()["voices"] == 1
    assert res.json()["artifacts"] >= 2
    assert not any(settings.artifact_dir.iterdir())


def test_cleanup_rejects_the_event_token(client):
    """合言葉はフロントのバンドルに載る＝参加者全員が読める。

    それで「全員分を消す」が通ってしまうと、イベント中に誰か一人の出来心で
    全滅する。合言葉だけでは 401 になること。
    """
    res = client.post("/cleanup")
    assert res.status_code == 401
    assert "管理者" in res.json()["detail"]


def test_cleanup_rejects_a_wrong_admin_token(client):
    res = client.post("/cleanup", headers={"X-Admin-Token": "nope"})
    assert res.status_code == 401


def test_cleanup_is_disabled_when_admin_token_is_unset(tmp_path):
    """未設定なら **開けっ放しにせず閉じる**。設定漏れを 503 で気づけるように。"""
    from fastapi.testclient import TestClient

    from app.interface.http import create_app

    from .conftest import TEST_ADMIN_TOKEN, make_settings

    app = create_app(make_settings(tmp_path, admin_token=""))
    with TestClient(app) as c:
        c.headers.update({"X-Event-Token": TEST_TOKEN, "X-Admin-Token": TEST_ADMIN_TOKEN})
        res = c.post("/cleanup")
        assert res.status_code == 503
        assert c.get("/ops").json()["auth"]["adminConfigured"] is False


def test_health_reports_render_capability(client):
    body = client.get("/health").json()
    assert "canRender" in body
    assert body["ttsEffective"] == "dummy"
    assert body["status"] in ("ok", "warming")


def test_health_counts_enrolled_children(client, fake_audio):
    """先生用画面の「人数」。台ごとの偏りを見るために使う。

    「何台つながっているか」は名簿から選ぶだけの端末が見えないので測れない。
    声を預けた時点で初めてサーバーの事実になる、という線引きをここで固定する。
    """
    assert client.get("/health").json()["voicesEnrolled"] == 0

    first = enroll(client, fake_audio)
    enroll(client, fake_audio)
    assert client.get("/health").json()["voicesEnrolled"] == 2

    # 次の子に渡すときは声を消す。人数もその場で減る（TTL 待ちにしない）。
    assert client.delete(f"/voices/{first}").json()["removed"] is True
    assert client.get("/health").json()["voicesEnrolled"] == 1
