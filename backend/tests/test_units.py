"""ドメイン層・アプリケーション層・インフラ層の単体テスト。"""

from __future__ import annotations

import math
import shutil
import struct
import time
import wave
from pathlib import Path

import pytest

from app.application.jobs import JobService
from app.application.voices import VoiceNotFound, VoiceService
from app.domain.models import JobState
from app.domain.timeline import InvalidTimeline, Segment, validate
from app.infrastructure.artifact_store import FsArtifactStore
from app.infrastructure.audio import FfmpegAudioConverter, wav_duration_sec
from app.infrastructure.clock import FakeClock
from app.infrastructure.tts_dummy import DummyTTS

# ---- ダミーTTS --------------------------------------------------------------


def test_dummy_tts_writes_valid_wav(tmp_path: Path):
    tts = DummyTTS()
    handle = tts.enroll(tmp_path / "ref.wav", "こんにちは")
    data = tts.synthesize(handle, "やあ、げんき？")

    out = tmp_path / "v.wav"
    out.write_bytes(data)
    with wave.open(str(out), "r") as w:
        assert w.getframerate() == 16000
        assert w.getnframes() > 0


def test_dummy_tts_varies_length_with_text(tmp_path: Path):
    tts = DummyTTS()
    handle = tts.enroll(tmp_path / "ref.wav", "")
    assert len(tts.synthesize(handle, "あいうえおかきくけこさしすせそ")) > len(tts.synthesize(handle, "あ"))


# ---- 生成物ストア -----------------------------------------------------------


def test_artifact_store_rejects_bad_ids(tmp_path: Path):
    store = FsArtifactStore(tmp_path / "a", default_ttl_sec=60)
    aid = store.put(b"x", ext="wav")
    assert store.path(aid) is not None
    # 形式が合わないIDはパスを組み立てずに None。
    for bad in ["../../etc/passwd", "abc.wav", aid.replace(".wav", ".exe"), ""]:
        assert store.path(bad) is None


def test_artifact_store_rejects_unknown_extension(tmp_path: Path):
    store = FsArtifactStore(tmp_path / "a", default_ttl_sec=60)
    with pytest.raises(ValueError):
        store.put(b"x", ext="exe")


def test_artifact_store_sweeps_expired(tmp_path: Path):
    import os

    store = FsArtifactStore(tmp_path / "a", default_ttl_sec=10)
    fresh = store.put(b"new", ext="wav")
    stale = store.put(b"old", ext="wav")

    path = tmp_path / "a" / stale
    old = time.time() - 60
    os.utime(path, (old, old))

    assert store.sweep() == 1
    assert store.path(stale) is None
    assert store.path(fresh) is not None


def test_artifact_store_per_item_ttl(tmp_path: Path):
    import os

    store = FsArtifactStore(tmp_path / "a", default_ttl_sec=10)
    long_lived = store.put(b"video", ext="mp4", ttl_sec=3600)
    path = tmp_path / "a" / long_lived
    old = time.time() - 60  # 既定TTLは超えるが個別TTLは超えない
    os.utime(path, (old, old))

    assert store.sweep() == 0
    assert store.path(long_lived) is not None


# ---- 声のTTL ---------------------------------------------------------------


class _StubConverter:
    def __init__(self, tmp: Path) -> None:
        self.tmp = tmp
        self.calls = 0

    def to_reference_wav(self, raw: bytes, suffix: str) -> Path:
        self.calls += 1
        p = self.tmp / f"ref-{self.calls}.wav"
        p.write_bytes(raw)
        return p


def _voice_service(tmp_path: Path, clock: FakeClock, ttl: int = 100):
    tmp_path.mkdir(parents=True, exist_ok=True)
    converter = _StubConverter(tmp_path)
    service = VoiceService(tts=DummyTTS(), converter=converter, clock=clock, ttl_sec=ttl)
    return service, converter


def test_voice_is_converted_once_per_child(tmp_path: Path):
    """エンロールを分けた狙いそのもの: 参照音声の変換は1人1回。"""
    clock = FakeClock()
    service, converter = _voice_service(tmp_path, clock)

    voice_id = service.enroll(b"audio", ".wav", "こんにちは")
    for _ in range(20):  # 20行生成しても
        service.handle(voice_id)

    assert converter.calls == 1  # 変換は1回きり


def test_voice_expires_and_reference_file_is_deleted(tmp_path: Path):
    clock = FakeClock()
    service, _ = _voice_service(tmp_path, clock, ttl=100)
    voice_id = service.enroll(b"audio", ".wav", "こんにちは")

    ref_files = list(tmp_path.glob("ref-*.wav"))
    assert len(ref_files) == 1

    clock.advance(101)
    with pytest.raises(VoiceNotFound):
        service.handle(voice_id)
    assert not ref_files[0].exists(), "期限切れの参照音声が残っている"


def test_touch_extends_voice_lifetime(tmp_path: Path):
    """長い作品づくりの途中で声が切れないこと。"""
    clock = FakeClock()
    service, _ = _voice_service(tmp_path, clock, ttl=100)
    voice_id = service.enroll(b"audio", ".wav", "x")

    for _ in range(5):
        clock.advance(80)
        service.touch(voice_id)
    assert service.handle(voice_id) is not None


# ---- ジョブ -----------------------------------------------------------------


class _SlowTTS(DummyTTS):
    """1行あたり少し時間のかかるTTS（キュー順位の確認用）。"""

    def __init__(self, delay: float = 0.05) -> None:
        super().__init__()
        self.delay = delay
        self.calls = 0

    def synthesize(self, handle, text: str) -> bytes:
        self.calls += 1
        time.sleep(self.delay)
        return super().synthesize(handle, text)


class _FlakyTTS(DummyTTS):
    """特定の行だけ失敗するTTS（部分成功の確認用）。"""

    def synthesize(self, handle, text: str) -> bytes:
        if text == "だめ":
            raise RuntimeError("この行は失敗する")
        return super().synthesize(handle, text)


def _job_service(tmp_path: Path, tts=None, workers: int = 1):
    clock = FakeClock()
    converter = _StubConverter(tmp_path)
    tts = tts or DummyTTS()
    voices = VoiceService(tts=tts, converter=converter, clock=clock, ttl_sec=10_000)
    artifacts = FsArtifactStore(tmp_path / "artifacts", default_ttl_sec=600)
    jobs = JobService(tts=tts, voices=voices, artifacts=artifacts, clock=clock, workers=workers, max_lines_per_job=100)
    jobs.start()
    return jobs, voices, artifacts


def _await(jobs: JobService, job_id: str, timeout: float = 10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        snap = jobs.snapshot(job_id)
        assert snap is not None
        if snap.state.is_terminal:
            return snap
        time.sleep(0.01)
    raise AssertionError("ジョブが終わらなかった")


def test_partial_failure_keeps_the_good_lines(tmp_path: Path):
    """16行中1行失敗しても、残りは使える（以前は全部ゼロになっていた）。"""
    jobs, voices, _ = _job_service(tmp_path, tts=_FlakyTTS())
    try:
        voice_id = voices.enroll(b"a", ".wav", "x")
        snap = jobs.submit(voice_id, ["よし", "だめ", "よし"])
        done = _await(jobs, snap.id)

        assert done.state is JobState.done
        ok = [r for r in done.results if r.ok]
        bad = [r for r in done.results if not r.ok]
        assert len(ok) == 2 and len(bad) == 1
        assert bad[0].index == 1
    finally:
        jobs.stop()


def test_queue_position_counts_jobs_ahead(tmp_path: Path):
    """待ち順位が出せること。3分の無言スピナーの代わりになる情報。"""
    jobs, voices, _ = _job_service(tmp_path, tts=_SlowTTS(delay=0.05))
    try:
        voice_id = voices.enroll(b"a", ".wav", "x")
        first = jobs.submit(voice_id, ["あ"] * 6)
        second = jobs.submit(voice_id, ["い"] * 6)

        snap = jobs.snapshot(second.id)
        assert snap is not None
        assert snap.queue_position >= 1  # 前に1件いる

        _await(jobs, first.id)
        _await(jobs, second.id)
        assert jobs.snapshot(second.id).queue_position == 0
    finally:
        jobs.stop()


def test_cancel_stops_dequeuing_further_lines(tmp_path: Path):
    """協調キャンセル: 走っている1行は終わるが、その先は合成されない。

    以前は asyncio.wait_for で中断しようとしていたが、別スレッドの処理は
    止められず、解放されたロックに次が入って二重実行になっていた。
    """
    tts = _SlowTTS(delay=0.03)
    jobs, voices, _ = _job_service(tmp_path, tts=tts)
    try:
        voice_id = voices.enroll(b"a", ".wav", "x")
        snap = jobs.submit(voice_id, ["あ"] * 50)
        time.sleep(0.05)
        assert jobs.cancel(snap.id) is True

        done = _await(jobs, snap.id)
        assert done.state is JobState.cancelled
        assert done.finished == 50  # 全行ぶん結果は埋まる
        # 合成された行はごく一部にとどまる（残りは取り出されずに終わる）。
        assert tts.calls < 50
    finally:
        jobs.stop()


def test_queue_depth_reaches_zero(tmp_path: Path):
    jobs, voices, _ = _job_service(tmp_path)
    try:
        voice_id = voices.enroll(b"a", ".wav", "x")
        snap = jobs.submit(voice_id, ["あ", "い", "う"])
        _await(jobs, snap.id)
        assert jobs.queue_depth() == 0
        assert jobs.active_jobs() == 0
    finally:
        jobs.stop()


def test_submit_rejects_expired_voice(tmp_path: Path):
    jobs, _voices, _ = _job_service(tmp_path)
    try:
        with pytest.raises(VoiceNotFound):
            jobs.submit("0" * 32, ["あ"])
    finally:
        jobs.stop()


# ---- タイムライン -----------------------------------------------------------


def _seg(start: int, dur: int, **kw) -> Segment:
    base = {"panel_path": "/panels/a.jpg", "subtitle": "", "artifact_id": None}
    base.update(kw)
    return Segment(start_ms=start, dur_ms=dur, **base)


def test_timeline_validates_and_computes_total():
    tl = validate([_seg(0, 250), _seg(250, 1000, subtitle="やあ"), _seg(1250, 500)])
    assert tl.total_ms == 1750
    assert tl.panel_paths == ("/panels/a.jpg",)  # 重複は畳まれる


def test_timeline_rejects_overlap_and_bad_duration():
    with pytest.raises(InvalidTimeline):
        validate([_seg(0, 1000), _seg(500, 1000)])  # 重なり
    with pytest.raises(InvalidTimeline):
        validate([_seg(0, 0)])
    with pytest.raises(InvalidTimeline):
        validate([])


def test_timeline_rejects_unsafe_panel_paths():
    """SSRF 対策: 任意のURL・上位ディレクトリを踏ませない。"""
    for bad in ["/panels/../../etc/passwd", "https://evil.example/x.jpg", "/other/a.jpg", "/panels/a/b.jpg"]:
        with pytest.raises(InvalidTimeline):
            validate([_seg(0, 100, panel_path=bad)])


def test_timeline_allows_missing_panel():
    tl = validate([_seg(0, 100, panel_path=None)])
    assert tl.panel_paths == ()


# ---- 音声変換 ---------------------------------------------------------------


def _write_wav(path: Path, silence_sec: float, tone_sec: float, rate: int = 16000) -> None:
    """先頭に無音、そのあとにトーンが入った wav を作る（録音の頭の「間」を模す）。"""
    with wave.open(str(path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        frames += b"\x00\x00" * int(rate * silence_sec)
        for i in range(int(rate * tone_sec)):
            frames += struct.pack("<h", int(0.6 * 32767 * math.sin(2 * math.pi * 440 * i / rate)))
        w.writeframes(bytes(frames))


def test_wav_duration_sec(tmp_path: Path):
    p = tmp_path / "a.wav"
    _write_wav(p, silence_sec=0.5, tone_sec=1.5)
    assert wav_duration_sec(p) == pytest.approx(2.0, abs=0.01)
    # 壊れたファイル・無いファイルは 0.0（呼び出し側の判定を止めない）。
    assert wav_duration_sec(tmp_path / "none.wav") == 0.0


def test_converter_keeps_going_without_ffmpeg(tmp_path: Path):
    conv = FfmpegAudioConverter(tmp_dir=tmp_path / "tmp", ffmpeg_bin="ffmpeg-does-not-exist")
    src = tmp_path / "ref.wav"
    _write_wav(src, silence_sec=0.2, tone_sec=1.0)
    out = conv.to_reference_wav(src.read_bytes(), ".wav")
    assert out.is_file() and out.read_bytes() == src.read_bytes()


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg が無い環境ではスキップ")
def test_converter_trims_leading_silence(tmp_path: Path):
    conv = FfmpegAudioConverter(tmp_dir=tmp_path / "tmp")
    src = tmp_path / "ref.wav"
    _write_wav(src, silence_sec=2.0, tone_sec=3.0)
    out = conv.to_reference_wav(src.read_bytes(), ".wav")
    # 頭の無音（2秒）が落ちて、声のぶん（3秒）＋わずかな余白だけが残る。
    assert wav_duration_sec(out) == pytest.approx(3.0, abs=0.3)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg が無い環境ではスキップ")
def test_converter_keeps_audio_when_almost_silent(tmp_path: Path):
    """ほぼ無音の録音を、カットしすぎて空にしてしまわないこと。"""
    conv = FfmpegAudioConverter(tmp_dir=tmp_path / "tmp")
    src = tmp_path / "quiet.wav"
    _write_wav(src, silence_sec=3.0, tone_sec=0.0)
    out = conv.to_reference_wav(src.read_bytes(), ".wav")
    assert wav_duration_sec(out) == pytest.approx(3.0, abs=0.1)


def test_converter_deletes_the_raw_upload(tmp_path: Path):
    """変換後の生アップロードを残さない（子どもの声を余分に持たない）。"""
    conv = FfmpegAudioConverter(tmp_dir=tmp_path / "tmp")
    src = tmp_path / "ref.wav"
    _write_wav(src, silence_sec=0.1, tone_sec=1.5)
    out = conv.to_reference_wav(src.read_bytes(), ".wav")
    uploads = list((tmp_path / "tmp").glob("upload-*"))
    assert uploads == [], f"アップロードの一時ファイルが残っている: {uploads}"
    assert out.is_file()


# ---- 生成音声の無音カット（numpy がある環境のみ）-----------------------------


def test_trim_silence_cuts_head_and_keeps_voice():
    np = pytest.importorskip("numpy")  # numpy は AI 環境（Colab）だけに入る
    from app.infrastructure.tts_qwen import trim_silence

    sr = 24000
    silence = np.zeros(int(sr * 0.8), dtype="float32")
    tone = (0.5 * np.sin(2 * np.pi * 440 * np.arange(sr) / sr)).astype("float32")
    out = trim_silence(np.concatenate([silence, tone, silence]), sr)

    # 声の長さ（1秒）＋前後に残す余白（0.05秒ずつ）程度に収まる。
    assert len(out) == pytest.approx(sr * 1.1, rel=0.05)
    assert float(np.max(np.abs(out))) == pytest.approx(0.5, abs=0.01)


def test_trim_silence_keeps_all_silent_input():
    np = pytest.importorskip("numpy")
    from app.infrastructure.tts_qwen import trim_silence

    silent = np.zeros(1000, dtype="float32")
    assert len(trim_silence(silent, 24000)) == 1000
