"""動画レンダリングのユースケース。

クライアントから受け取ったタイムラインを、写真と音声に解決して動画にする。
GPU を使わないので TTS のワーカープールとは別枠で動かす（音声生成を待たせない）。
"""

from __future__ import annotations

import logging
import threading

from ..domain.models import ArtifactId
from ..domain.timeline import Timeline
from .ports import ArtifactStore, PanelFetcher, VideoRenderer

log = logging.getLogger("koekomi.render")


class RenderUnavailable(RuntimeError):
    """この環境ではサーバー側レンダリングができない（クライアント書き出しに任せる）。"""


class RenderFailed(RuntimeError):
    pass


class RenderService:
    def __init__(
        self,
        *,
        renderer: VideoRenderer,
        artifacts: ArtifactStore,
        panels: PanelFetcher,
        max_concurrent: int = 2,
        video_ttl_sec: int = 1800,
    ) -> None:
        self._renderer = renderer
        self._artifacts = artifacts
        self._panels = panels
        self._slots = threading.Semaphore(max(1, max_concurrent))
        self._ttl = video_ttl_sec

    @property
    def available(self) -> bool:
        return self._renderer.available()

    @property
    def unavailable_reason(self) -> str | None:
        return self._renderer.unavailable_reason()

    def render(self, timeline: Timeline) -> tuple[ArtifactId, int]:
        """動画を作って ArtifactId と TTL(秒) を返す。"""
        if not self._renderer.available():
            raise RenderUnavailable(self._renderer.unavailable_reason() or "レンダリングを利用できません")

        # 音声は必須。1つでも欠けると無音の動画が黙って出来てしまうので先に止める。
        audio_files = {}
        for aid in timeline.artifact_ids:
            path = self._artifacts.path(aid)
            if path is None:
                raise RenderFailed("音声が見つかりませんでした。もう一度作り直してください。")
            audio_files[aid] = path

        # 写真は欠けても暗転で通す（作品が完成しないよりはよい）。
        panel_files = {}
        for panel_path in timeline.panel_paths:
            got = self._panels.fetch(panel_path)
            if got is None:
                log.warning("写真を取得できませんでした（暗転で続行）: %s", panel_path)
                continue
            panel_files[panel_path] = got

        acquired = self._slots.acquire(timeout=120)
        if not acquired:
            raise RenderFailed("いま混み合っています。少し待ってからもう一度お試しください。")
        try:
            log.info(
                "レンダリング開始: %d 区間 / %.1f 秒",
                len(timeline.segments),
                timeline.total_ms / 1000,
            )
            data = self._renderer.render(timeline, panel_files, audio_files)
        finally:
            self._slots.release()

        artifact_id = self._artifacts.put(data, ext="mp4", ttl_sec=self._ttl)
        log.info("レンダリング完了: %s (%.1f MB)", artifact_id, len(data) / 1024 / 1024)
        return artifact_id, self._ttl
