"""4コマ劇場のタイムライン。

「いつ・どの写真を・どの字幕とともに・どの音声を鳴らして映すか」という
再生規則を表すデータ構造。**この構造が仕様の単一の正**であり、
次の3者が同じものを解釈する:

  1. ブラウザの劇場プレイヤー（再生）
  2. ブラウザの MediaRecorder 書き出し（フォールバック）
  3. このサーバーの ffmpeg レンダリング（本番）

以前は 1 と 2 がそれぞれ独立にタイミング計算を持っていて、片方を直すと
ズレる状態だった。タイムラインの**組み立て**はクライアント側の
`domain/timeline.ts` に一本化し、サーバーは組み上がったものを
受け取って検証・描画するだけにしている（計算を二重に持たない）。
"""

from __future__ import annotations

from dataclasses import dataclass

from .models import ArtifactId

# 書き出しサイズ（劇場のスクリーンと同じ 16:10）。
FRAME_WIDTH = 1280
FRAME_HEIGHT = 800

# 受け入れ上限。悪意ある入力でサーバーを何時間も回させないための歯止め。
MAX_SEGMENTS = 400
MAX_TOTAL_MS = 10 * 60 * 1000
MAX_SEGMENT_MS = 60 * 1000


class InvalidTimeline(ValueError):
    """タイムラインが受け入れ条件を満たしていない。"""


@dataclass(frozen=True)
class Segment:
    """タイムライン上の1区間。

    panel_path はフロントの公開パス（例: `/panels/ant.jpg`）。
    完全なURLではなくパスだけを受け取り、サーバー側で決め打ちの
    フロントオリジンと結合する。任意のURLを取りに行かせない（SSRF対策）。
    """

    start_ms: int
    dur_ms: int
    panel_path: str | None
    subtitle: str
    artifact_id: ArtifactId | None

    @property
    def end_ms(self) -> int:
        return self.start_ms + self.dur_ms


@dataclass(frozen=True)
class Timeline:
    segments: tuple[Segment, ...]

    @property
    def total_ms(self) -> int:
        return max((s.end_ms for s in self.segments), default=0)

    @property
    def panel_paths(self) -> tuple[str, ...]:
        """重複を除いた写真パス（取得は1枚につき1回でよい）。"""
        seen: dict[str, None] = {}
        for s in self.segments:
            if s.panel_path:
                seen.setdefault(s.panel_path, None)
        return tuple(seen)

    @property
    def artifact_ids(self) -> tuple[ArtifactId, ...]:
        seen: dict[str, None] = {}
        for s in self.segments:
            if s.artifact_id:
                seen.setdefault(s.artifact_id, None)
        return tuple(seen)


def validate(segments: list[Segment]) -> Timeline:
    """受け取った区間列を検証して Timeline にする。問題があれば InvalidTimeline。"""
    if not segments:
        raise InvalidTimeline("書き出す内容がありません。")
    if len(segments) > MAX_SEGMENTS:
        raise InvalidTimeline(f"区間が多すぎます（{MAX_SEGMENTS} まで）。")

    cursor = 0
    for i, s in enumerate(segments):
        if s.dur_ms <= 0 or s.dur_ms > MAX_SEGMENT_MS:
            raise InvalidTimeline(f"区間 {i} の長さが不正です。")
        if s.start_ms < cursor:
            raise InvalidTimeline(f"区間 {i} の開始時刻が前の区間と重なっています。")
        if s.panel_path is not None and not _is_safe_panel_path(s.panel_path):
            raise InvalidTimeline(f"区間 {i} の写真パスが不正です。")
        cursor = s.end_ms

    if cursor > MAX_TOTAL_MS:
        raise InvalidTimeline("動画が長すぎます。")
    return Timeline(segments=tuple(segments))


def _is_safe_panel_path(path: str) -> bool:
    """`/panels/xxx.jpg` の形だけを許す。上位ディレクトリや別ホストへ逃がさない。"""
    if not path.startswith("/panels/"):
        return False
    if ".." in path or "//" in path or "\\" in path:
        return False
    return path.count("/") == 2 and len(path) < 200
