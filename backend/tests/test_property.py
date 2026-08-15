"""プロパティテスト（Hypothesis）。

手で書いたテストは「自分が思いついた入力」しか試せない。ここでは
**任意の入力**について性質が成り立つことを確かめる。

特に `validate()` は公開エンドポイント `/render` の入口であり、
ここを抜けた値が ffmpeg のコマンドラインに載る。「どんな入力でも
例外で落ちるか、安全な Timeline になるかのどちらか」であってほしい。
"""

from __future__ import annotations

import string

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from app.domain.timeline import (
    MAX_SEGMENTS,
    MAX_TOTAL_MS,
    InvalidTimeline,
    Segment,
    Timeline,
    validate,
)
from app.infrastructure.artifact_store import FsArtifactStore

# ---- 入力の作り方 ------------------------------------------------------------

# 「/panels/名前.拡張子」の形だけが通るはず。
safe_panel = st.builds(
    lambda name, ext: f"/panels/{name}.{ext}",
    st.text(alphabet=string.ascii_letters + string.digits + "-_", min_size=1, max_size=20),
    st.sampled_from(["jpg", "jpeg", "png", "webp"]),
)

# 危ないパス。1つでも通ったら SSRF / パストラバーサルの穴になる。
unsafe_panel = st.sampled_from(
    [
        "/panels/../../etc/passwd",
        "/panels//evil.jpg",
        "/panels/a/b.jpg",
        "https://evil.example/x.jpg",
        "//evil.example/x.jpg",
        "/other/a.jpg",
        "panels/a.jpg",
        "/panels/" + "a" * 300 + ".jpg",
        "/panels/a\\b.jpg",
    ]
)

artifact_id = st.builds(
    lambda h, ext: f"{h}.{ext}",
    st.text(alphabet="0123456789abcdef", min_size=32, max_size=32),
    st.sampled_from(["wav", "mp4", "webm"]),
)


@st.composite
def contiguous_segments(draw, max_count: int = 12) -> list[Segment]:
    """隙間なく連続する、正しい区間列（クライアントが作る形）。"""
    count = draw(st.integers(min_value=1, max_value=max_count))
    cursor = 0
    segments: list[Segment] = []
    for _ in range(count):
        dur = draw(st.integers(min_value=1, max_value=5000))
        segments.append(
            Segment(
                start_ms=cursor,
                dur_ms=dur,
                panel_path=draw(st.one_of(st.none(), safe_panel)),
                subtitle=draw(st.text(max_size=60)),
                artifact_id=draw(st.one_of(st.none(), artifact_id)),
            )
        )
        cursor += dur
    return segments


SETTINGS = settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow], deadline=None)


# ---- validate の性質 ---------------------------------------------------------


@SETTINGS
@given(contiguous_segments())
def test_contiguous_segments_are_always_accepted(segments: list[Segment]):
    """正しく作った区間列は、必ず受理される（クライアントが作る形は常に通る）。"""
    timeline = validate(segments)
    assert isinstance(timeline, Timeline)
    assert len(timeline.segments) == len(segments)


@SETTINGS
@given(contiguous_segments())
def test_total_is_the_end_of_the_last_segment(segments: list[Segment]):
    timeline = validate(segments)
    assert timeline.total_ms == segments[-1].start_ms + segments[-1].dur_ms


@SETTINGS
@given(contiguous_segments())
def test_panel_paths_and_artifacts_are_deduplicated_but_complete(segments: list[Segment]):
    """重複は畳むが、取りこぼさない（写真の取得も音声の解決も1回ずつ）。"""
    timeline = validate(segments)

    expected_panels = {s.panel_path for s in segments if s.panel_path}
    assert set(timeline.panel_paths) == expected_panels
    assert len(timeline.panel_paths) == len(set(timeline.panel_paths))

    expected_artifacts = {s.artifact_id for s in segments if s.artifact_id}
    assert set(timeline.artifact_ids) == expected_artifacts


@SETTINGS
@given(contiguous_segments(), unsafe_panel)
def test_unsafe_panel_paths_are_always_rejected(segments: list[Segment], bad: str):
    """危ない写真パスは、どこに混ざっていても必ず弾く。

    ここを抜けると、サーバーが任意のURLを取りに行く（SSRF）か、
    意図しないファイルを読むことになる。
    """
    poisoned = [
        Segment(
            start_ms=segments[0].start_ms,
            dur_ms=segments[0].dur_ms,
            panel_path=bad,
            subtitle=segments[0].subtitle,
            artifact_id=segments[0].artifact_id,
        ),
        *segments[1:],
    ]
    with pytest.raises(InvalidTimeline):
        validate(poisoned)


@SETTINGS
@given(st.integers(min_value=-100000, max_value=0))
def test_non_positive_duration_is_rejected(dur: int):
    with pytest.raises(InvalidTimeline):
        validate([Segment(start_ms=0, dur_ms=dur, panel_path=None, subtitle="", artifact_id=None)])


@SETTINGS
@given(contiguous_segments(max_count=6), st.integers(min_value=1, max_value=5000))
def test_overlapping_segments_are_rejected(segments: list[Segment], overlap: int):
    """区間が重なっていたら弾く（音が重なった動画を作らせない）。"""
    if len(segments) < 2:
        return
    second = segments[1]
    broken = [
        segments[0],
        Segment(
            start_ms=max(0, second.start_ms - overlap),
            dur_ms=second.dur_ms,
            panel_path=second.panel_path,
            subtitle=second.subtitle,
            artifact_id=second.artifact_id,
        ),
        *segments[2:],
    ]
    if broken[1].start_ms >= segments[0].start_ms + segments[0].dur_ms:
        return  # 重なっていない（overlap が小さすぎた）
    with pytest.raises(InvalidTimeline):
        validate(broken)


@SETTINGS
@given(st.integers(min_value=MAX_SEGMENTS + 1, max_value=MAX_SEGMENTS + 50))
def test_too_many_segments_are_rejected(count: int):
    """歯止めが効くこと（悪意ある入力でサーバーを何時間も回させない）。"""
    segments = [Segment(start_ms=i, dur_ms=1, panel_path=None, subtitle="", artifact_id=None) for i in range(count)]
    with pytest.raises(InvalidTimeline):
        validate(segments)


@SETTINGS
@given(st.integers(min_value=1, max_value=200))
def test_too_long_timeline_is_rejected(chunks: int):
    """全体が長すぎるものは弾く。"""
    dur = MAX_TOTAL_MS // chunks + 1000
    cursor = 0
    segments = []
    for _ in range(chunks):
        segments.append(Segment(start_ms=cursor, dur_ms=dur, panel_path=None, subtitle="", artifact_id=None))
        cursor += dur
    if cursor <= MAX_TOTAL_MS or len(segments) > MAX_SEGMENTS:
        return  # 条件を満たさない組み合わせは対象外
    with pytest.raises(InvalidTimeline):
        validate(segments)


# ---- 生成物ストアの性質 ------------------------------------------------------


@SETTINGS
@given(st.text(max_size=80))
def test_artifact_store_never_escapes_its_directory(tmp_path_factory_text: str):
    """どんな文字列を渡しても、保管ディレクトリの外を指さない。

    ID をそのままパスに結合していた頃なら、`../` で外に出られた。
    いまは正規表現で形を検証してから触るので、不正なものは None になる。
    """
    import tempfile
    from pathlib import Path

    root = Path(tempfile.mkdtemp(prefix="koekomi-prop-"))
    store = FsArtifactStore(root, default_ttl_sec=60)

    got = store.path(tmp_path_factory_text)
    if got is not None:
        assert root.resolve() in got.resolve().parents


@SETTINGS
@given(st.binary(max_size=2048), st.sampled_from(["wav", "mp4", "webm"]))
def test_artifact_roundtrip(data: bytes, ext: str):
    """入れたものがそのまま返り、IDは毎回違う（推測できない）。"""
    import tempfile
    from pathlib import Path

    store = FsArtifactStore(Path(tempfile.mkdtemp(prefix="koekomi-prop-")), default_ttl_sec=60)
    first = store.put(data, ext=ext)
    second = store.put(data, ext=ext)

    assert first != second  # 同じ中身でもIDは別
    assert first.endswith(f".{ext}")
    path = store.path(first)
    assert path is not None
    assert path.read_bytes() == data
