"""動画レンダリングのテスト。

描画（Pillow）と ffmpeg 呼び出しの組み立ては分けて検証する。
ffmpeg 本体が無い環境でも、少なくとも「使えないことを正しく申告し、
クライアント書き出しにフォールバックできる」ことは確認できる。
"""

from __future__ import annotations

import io
import re
import shutil
import subprocess
import wave
from pathlib import Path

import pytest

from app.domain.timeline import FRAME_HEIGHT, FRAME_WIDTH, Segment, validate
from app.infrastructure.video_ffmpeg import FfmpegVideoRenderer, find_japanese_font

pytest.importorskip("PIL")

HAS_FONT = find_japanese_font() is not None
HAS_FFMPEG = shutil.which("ffmpeg") is not None


def _timeline():
    return validate(
        [
            Segment(start_ms=0, dur_ms=250, panel_path="/panels/a.jpg", subtitle="", artifact_id=None),
            Segment(
                start_ms=250,
                dur_ms=1200,
                panel_path="/panels/a.jpg",
                subtitle="こんにちは！げんきですか？",
                artifact_id="a" * 32 + ".wav",
            ),
            Segment(start_ms=1450, dur_ms=500, panel_path=None, subtitle="", artifact_id=None),
        ]
    )


def _wav(tmp_path: Path) -> Path:
    """1秒の無音 wav（声の代わり）。"""
    buf = io.BytesIO()
    with wave.open(buf, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * 16000)
    path = tmp_path / "voice.wav"
    path.write_bytes(buf.getvalue())
    return path


def _panel(tmp_path: Path) -> Path:
    from PIL import Image

    p = tmp_path / "panel.jpg"
    Image.new("RGB", (800, 600), (200, 120, 60)).save(p)
    return p


def test_unavailable_reason_is_actionable():
    """使えないとき、何を入れればよいか分かるメッセージを返すこと。"""
    r = FfmpegVideoRenderer(ffmpeg_bin="ffmpeg-does-not-exist")
    assert r.available() is False
    assert "ffmpeg" in (r.unavailable_reason() or "")


@pytest.mark.skipif(not HAS_FONT, reason="日本語フォントが無い環境ではスキップ")
def test_frame_is_composed_at_export_size(tmp_path: Path):
    from PIL import Image

    from app.infrastructure.video_ffmpeg import _compose_frame

    panel = Image.open(_panel(tmp_path)).convert("RGB")
    frame = _compose_frame(panel, "こんにちは！", find_japanese_font())
    assert frame.size == (FRAME_WIDTH, FRAME_HEIGHT)


@pytest.mark.skipif(not HAS_FONT, reason="日本語フォントが無い環境ではスキップ")
def test_frame_without_panel_is_dark(tmp_path: Path):
    """写真が無いコマは暗転（作品づくりを止めない）。"""
    from app.infrastructure.video_ffmpeg import SCREEN_BG, _compose_frame

    frame = _compose_frame(None, "", find_japanese_font())
    assert frame.getpixel((10, 10)) == SCREEN_BG


@pytest.mark.skipif(not HAS_FONT, reason="日本語フォントが無い環境ではスキップ")
def test_subtitle_changes_the_bottom_of_the_frame(tmp_path: Path):
    """字幕を描くと下部が変わる（スクリム＋文字が乗っている）こと。"""
    from PIL import Image

    from app.infrastructure.video_ffmpeg import _compose_frame

    panel = Image.open(_panel(tmp_path)).convert("RGB")
    font = find_japanese_font()
    plain = _compose_frame(panel, "", font)
    subbed = _compose_frame(panel, "やあ", font)

    y = FRAME_HEIGHT - 60
    assert plain.getpixel((FRAME_WIDTH // 2, y)) != subbed.getpixel((FRAME_WIDTH // 2, y))
    # 上部（写真だけの領域）は変わらない。
    assert plain.getpixel((10, 10)) == subbed.getpixel((10, 10))


@pytest.mark.skipif(not HAS_FONT, reason="日本語フォントが無い環境ではスキップ")
def test_long_subtitle_is_wrapped_to_three_lines(tmp_path: Path):
    from PIL import Image, ImageDraw, ImageFont

    from app.infrastructure.video_ffmpeg import MAX_SUBTITLE_LINES, _wrap

    img = Image.new("RGB", (10, 10))
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(find_japanese_font(), 54, index=0)
    lines = _wrap(draw, "あ" * 200, font, FRAME_WIDTH * 0.88)
    assert 1 <= len(lines) <= MAX_SUBTITLE_LINES


@pytest.mark.skipif(not HAS_FONT, reason="日本語フォントが無い環境ではスキップ")
def test_frames_are_reused_for_identical_segments(tmp_path: Path):
    """同じ（写真・字幕）の組は描き直さない。"""
    r = FfmpegVideoRenderer(work_dir=tmp_path)
    tl = validate(
        [
            Segment(start_ms=0, dur_ms=100, panel_path="/panels/a.jpg", subtitle="やあ", artifact_id=None),
            Segment(start_ms=100, dur_ms=100, panel_path="/panels/a.jpg", subtitle="やあ", artifact_id=None),
            Segment(start_ms=200, dur_ms=100, panel_path="/panels/a.jpg", subtitle="ちがう", artifact_id=None),
        ]
    )
    work = tmp_path / "w"
    work.mkdir()
    frames = r._draw_frames(tl, {"/panels/a.jpg": _panel(tmp_path)}, work)
    assert len(frames) == 3
    assert frames[0] == frames[1] != frames[2]  # 同じ絵はファイルも同じ
    assert len(list(work.glob("*.png"))) == 2


def test_concat_list_repeats_the_last_frame(tmp_path: Path):
    """concat デマクサは最後の1枚を重ねて書かないと末尾が切れる。"""
    r = FfmpegVideoRenderer()
    frames = [tmp_path / "f0.png", tmp_path / "f1.png"]
    tl = validate(
        [
            Segment(start_ms=0, dur_ms=250, panel_path=None, subtitle="", artifact_id=None),
            Segment(start_ms=250, dur_ms=1000, panel_path=None, subtitle="", artifact_id=None),
        ]
    )
    listing = r._write_concat_list(tl, frames, tmp_path).read_text(encoding="utf-8")
    assert listing.count("f1.png") == 2
    assert "duration 0.250" in listing and "duration 1.000" in listing


def _video_seconds(path: Path) -> float:
    """動画の**映像トラック**の長さ（秒）。

    コンテナの Duration ではなく映像だけを数える。音声で尺が埋まっていると、
    映像が一瞬で終わっていてもコンテナ上は正しく見えてしまうため。
    """
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(path), "-map", "0:v", "-f", "null", "-"],
        capture_output=True,
        text=True,
    ).stderr
    times = re.findall(r"time=(\d+):(\d+):(\d+\.\d+)", out)
    if not times:
        return 0.0
    h, m, s = times[-1]
    return int(h) * 3600 + int(m) * 60 + float(s)


@pytest.mark.skipif(not (HAS_FFMPEG and HAS_FONT), reason="ffmpeg / 日本語フォントが必要")
def test_render_produces_a_playable_mp4(tmp_path: Path):
    """実際に mp4 を作れること（ffmpeg のある環境でのみ）。"""
    r = FfmpegVideoRenderer(work_dir=tmp_path)
    data = r.render(_timeline(), {"/panels/a.jpg": _panel(tmp_path)}, {"a" * 32 + ".wav": _wav(tmp_path)})
    assert len(data) > 1000
    assert data[4:8] == b"ftyp"  # mp4 のシグネチャ


@pytest.mark.skipif(not (HAS_FFMPEG and HAS_FONT), reason="ffmpeg / 日本語フォントが必要")
def test_rendered_video_matches_the_timeline_length(tmp_path: Path):
    """**映像の尺がタイムラインと一致すること。**

    ここは一度壊していた。concat デマクサの可変長フレームを出力側の
    `-r`/`-fps_mode cfr` で均そうとすると、`-t` が展開前の尺で切ってしまい、
    2.25秒の作品が 0.26秒の映像になっていた。音声で尺が埋まるため、
    ファイルサイズやシグネチャの確認では気づけない。
    """
    timeline = _timeline()  # 250 + 1200 + 500 = 1950ms
    r = FfmpegVideoRenderer(work_dir=tmp_path)
    data = r.render(timeline, {"/panels/a.jpg": _panel(tmp_path)}, {"a" * 32 + ".wav": _wav(tmp_path)})

    out = tmp_path / "out.mp4"
    out.write_bytes(data)
    expected = timeline.total_ms / 1000
    assert _video_seconds(out) == pytest.approx(expected, abs=0.15)


@pytest.mark.skipif(not (HAS_FFMPEG and HAS_FONT), reason="ffmpeg / 日本語フォントが必要")
def test_renders_without_any_voice(tmp_path: Path):
    """声が1つも無い作品（読み上げモード等）でも動画にはなること。"""
    timeline = validate(
        [
            Segment(start_ms=0, dur_ms=800, panel_path="/panels/a.jpg", subtitle="こえなし", artifact_id=None),
        ]
    )
    r = FfmpegVideoRenderer(work_dir=tmp_path)
    data = r.render(timeline, {"/panels/a.jpg": _panel(tmp_path)}, {})

    out = tmp_path / "silent.mp4"
    out.write_bytes(data)
    assert _video_seconds(out) == pytest.approx(0.8, abs=0.15)
