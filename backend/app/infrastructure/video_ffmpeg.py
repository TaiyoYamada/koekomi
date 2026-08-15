"""タイムライン → mp4（Pillow で各区間の絵を描き、ffmpeg でつなぐ）。

■ なぜサーバーで作るのか
    クライアントの MediaRecorder は **実時間** で録画する。60秒の作品は
    60秒かかり、その間に子どもがタブを移動したりiPadを伏せたりすると
    タイマーが絞られて壊れた動画ができる。サーバーには ffmpeg も音声も
    あるのだから、数秒で確定的に作れる。

■ なぜ字幕を Pillow で焼き込むのか
    libass + fontconfig に頼るより依存が読みやすく、折り返しの規則を
    クライアントのプレビューと一致させられる（同じ「1文字ずつ詰める」方式）。
    日本語フォントが無い環境では available() が False を返し、
    クライアント側の書き出しに自動でフォールバックする。
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

from ..domain.timeline import FRAME_HEIGHT, FRAME_WIDTH, Timeline

log = logging.getLogger("koekomi.video")

# 画面が真っ暗なときの背景色（フロントの .theater-screen と同じ）。
SCREEN_BG = (11, 15, 23)

FPS = 30
MAX_SUBTITLE_LINES = 3

# 日本語フォントの探索先。Colab は fonts-noto-cjk を入れると1番目に入る。
_FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
    "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    "C:/Windows/Fonts/meiryob.ttc",
)


def find_japanese_font(explicit: str = "") -> str | None:
    """日本語が描けるフォントのパス。見つからなければ None。"""
    if explicit:
        return explicit if Path(explicit).is_file() else None
    for path in _FONT_CANDIDATES:
        if Path(path).is_file():
            return path
    # 決め打ちで見つからなければ Noto CJK を広めに探す。
    for root in ("/usr/share/fonts", "/usr/local/share/fonts"):
        base = Path(root)
        if not base.is_dir():
            continue
        for pattern in ("**/NotoSansCJK*", "**/NotoSerifCJK*", "**/*Gothic*"):
            for hit in base.glob(pattern):
                if hit.is_file() and hit.suffix.lower() in {".ttc", ".otf", ".ttf"}:
                    return str(hit)
    return None


class FfmpegVideoRenderer:
    def __init__(self, *, ffmpeg_bin: str = "ffmpeg", font_path: str = "", work_dir: Path | None = None) -> None:
        self._bin = ffmpeg_bin
        self._font_hint = font_path
        self._work_dir = work_dir

    # ---- VideoRenderer ポート ---------------------------------------------

    def available(self) -> bool:
        return self.unavailable_reason() is None

    def unavailable_reason(self) -> str | None:
        if shutil.which(self._bin) is None:
            return f"ffmpeg が見つかりません（{self._bin}）"
        try:
            import PIL  # noqa: F401
        except Exception:
            return "Pillow が入っていません"
        if find_japanese_font(self._font_hint) is None:
            return "日本語フォントが見つかりません（fonts-noto-cjk を入れてください）"
        return None

    def render(
        self,
        timeline: Timeline,
        panel_files: dict[str, Path],
        audio_files: dict[str, Path],
    ) -> bytes:
        reason = self.unavailable_reason()
        if reason:
            raise RuntimeError(reason)

        with tempfile.TemporaryDirectory(dir=self._work_dir) as tmp:
            work = Path(tmp)
            frames = self._draw_frames(timeline, panel_files, work)
            concat = self._write_concat_list(timeline, frames, work)
            out = work / "out.mp4"
            self._run_ffmpeg(timeline, concat, audio_files, out)
            return out.read_bytes()

    # ---- 描画 -------------------------------------------------------------

    def _draw_frames(self, timeline: Timeline, panel_files: dict[str, Path], work: Path) -> list[Path]:
        """区間ごとの絵を描く。同じ（写真・字幕）の組は使い回す。"""
        from PIL import Image

        font_path = find_japanese_font(self._font_hint)
        assert font_path is not None  # available() で確認済み

        # 写真は1枚につき1回だけ読み込む。
        loaded: dict[str, Image.Image] = {}
        for path, file in panel_files.items():
            try:
                loaded[path] = Image.open(file).convert("RGB")
            except Exception as e:
                log.warning("写真を開けませんでした（暗転で続行）: %s (%s)", file, e)

        cache: dict[tuple[str | None, str], Path] = {}
        frames: list[Path] = []
        for i, seg in enumerate(timeline.segments):
            key = (seg.panel_path, seg.subtitle)
            hit = cache.get(key)
            if hit is None:
                img = _compose_frame(loaded.get(seg.panel_path or ""), seg.subtitle, font_path)
                hit = work / f"f{i:04d}.png"
                img.save(hit, format="PNG")
                cache[key] = hit
            frames.append(hit)
        log.info("フレームを %d 枚描画しました（実体 %d 枚）", len(frames), len(cache))
        return frames

    def _write_concat_list(self, timeline: Timeline, frames: list[Path], work: Path) -> Path:
        """concat デマクサ用のリスト。最後の1枚は作法として重ねて書く。"""
        lines: list[str] = []
        for seg, frame in zip(timeline.segments, frames, strict=True):
            lines.append(f"file '{frame.as_posix()}'")
            lines.append(f"duration {seg.dur_ms / 1000:.3f}")
        if frames:
            lines.append(f"file '{frames[-1].as_posix()}'")
        path = work / "frames.txt"
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return path

    # ---- ffmpeg -----------------------------------------------------------

    def _run_ffmpeg(
        self,
        timeline: Timeline,
        concat: Path,
        audio_files: dict[str, Path],
        out: Path,
    ) -> None:
        total_sec = timeline.total_ms / 1000
        cmd = [self._bin, "-y", "-hide_banner", "-loglevel", "error"]
        cmd += ["-f", "concat", "-safe", "0", "-i", str(concat)]

        # 音声を鳴らす区間を、開始時刻ぶん遅らせて重ねる。
        voiced = [s for s in timeline.segments if s.artifact_id and s.artifact_id in audio_files]
        for seg in voiced:
            cmd += ["-i", str(audio_files[seg.artifact_id])]

        # 映像は必ずフィルタで等間隔に展開する。
        #
        # ここは一度間違えた場所なので理由を残す:
        # concat デマクサの `duration` は「その絵を何秒映すか」を可変長で表す。
        # これを出力側の `-r 30 -fps_mode cfr` で均そうとすると、フレームの複製は
        # `-t` の判定より後に行われるため、**`-t` が展開前の短い尺で切ってしまう**。
        # 実際 2.25秒の作品が 0.26秒の動画になっていた（尺だけ音声で埋まるので
        # 一見それらしく見えてしまう）。`fps` フィルタで先に展開すれば正しく揃う。
        video_chain = f"[0:v]fps={FPS},format=yuv420p[v]"

        if voiced:
            parts = [video_chain]
            for i, seg in enumerate(voiced, start=1):
                parts.append(f"[{i}:a]aresample=44100,adelay=delays={seg.start_ms}:all=1[a{i}]")
            mix_inputs = "".join(f"[a{i}]" for i in range(1, len(voiced) + 1))
            parts.append(f"{mix_inputs}amix=inputs={len(voiced)}:normalize=0:dropout_transition=0,apad[aout]")
            cmd += ["-filter_complex", ";".join(parts), "-map", "[v]", "-map", "[aout]"]
        else:
            # 声が1つも無い作品でも動画にはする（無音トラックを足す）。
            cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono"]
            cmd += ["-filter_complex", video_chain, "-map", "[v]", "-map", "1:a"]

        cmd += [
            "-t",
            f"{total_sec:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            str(out),
        ]

        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=600)
        except subprocess.CalledProcessError as e:
            tail = (e.stderr or b"").decode("utf-8", "replace")[-800:]
            log.error("ffmpeg が失敗しました:\n%s", tail)
            raise RuntimeError("動画の作成に失敗しました。") from e
        except subprocess.SubprocessError as e:
            raise RuntimeError("動画の作成に失敗しました。") from e

        if not out.is_file() or out.stat().st_size == 0:
            raise RuntimeError("動画の作成に失敗しました（出力が空です）。")


# ---- 1フレームの描画（クライアントの drawFrame と同じ見た目にする） ----------


def _compose_frame(panel, subtitle: str, font_path: str):
    from PIL import Image, ImageDraw, ImageFont

    w, h = FRAME_WIDTH, FRAME_HEIGHT
    canvas = Image.new("RGB", (w, h), SCREEN_BG)

    if panel is not None:
        canvas.paste(_cover(panel, w, h), (0, 0))

    if not subtitle:
        return canvas

    font_size = round(w * 0.042)
    font = _load_font(ImageFont, font_path, font_size)
    draw = ImageDraw.Draw(canvas)

    lines = _wrap(draw, subtitle, font, w * 0.88)
    line_height = round(font_size * 1.5)
    bottom_pad = round(h * 0.045)
    block_top = h - bottom_pad - line_height * len(lines)

    # 下からの黒グラデーション（フロントの .theater-subtitle と同じ狙い）。
    grad_top = max(0, block_top - round(font_size * 1.6))
    _paint_scrim(canvas, grad_top, h)

    draw = ImageDraw.Draw(canvas)
    for i, text in enumerate(lines):
        baseline = block_top + line_height * (i + 1) - round(font_size * 0.35)
        y = baseline - font_size
        # 影 → 本体の順で描く（読みやすさのため）。
        draw.text((w / 2 + 2, y + 2), text, font=font, fill=(0, 0, 0), anchor="ma")
        draw.text((w / 2, y), text, font=font, fill=(255, 255, 255), anchor="ma")
    return canvas


def _load_font(image_font_module, path: str, size: int):
    try:
        # .ttc は最初のフェイスを使う。
        return image_font_module.truetype(path, size, index=0)
    except Exception:
        return image_font_module.truetype(path, size)


def _cover(img, w: int, h: int):
    """object-fit: cover 相当（中央固定）。"""
    from PIL import Image

    iw, ih = img.size
    scale = max(w / iw, h / ih)
    nw, nh = max(1, round(iw * scale)), max(1, round(ih * scale))
    resized = img.resize((nw, nh), Image.LANCZOS)
    left = (nw - w) // 2
    top = (nh - h) // 2
    return resized.crop((left, top, left + w, top + h))


def _paint_scrim(canvas, top: int, bottom: int) -> None:
    """下端に向かって濃くなる黒のグラデーションを重ねる。"""
    from PIL import Image

    height = max(1, bottom - top)
    scrim = Image.new("L", (1, height))
    for y in range(height):
        # 上端 0 → 下端 0.78
        scrim.putpixel((0, y), int(255 * 0.78 * (y / max(1, height - 1))))
    mask = scrim.resize((canvas.width, height))
    black = Image.new("RGB", (canvas.width, height), (0, 0, 0))
    canvas.paste(black, (0, top), mask)


def _wrap(draw, text: str, font, max_width: float) -> list[str]:
    """日本語は単語区切りが無いので1文字ずつ詰める（クライアントと同じ規則）。"""
    lines: list[str] = []
    line = ""
    for ch in text:
        nxt = line + ch
        if line and draw.textlength(nxt, font=font) > max_width:
            lines.append(line)
            line = ch
        else:
            line = nxt
    if line:
        lines.append(line)
    return lines[:MAX_SUBTITLE_LINES]
