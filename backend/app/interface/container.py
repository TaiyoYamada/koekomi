"""組み立て（composition root）。

**具体実装を選ぶのはこのファイルだけ。** 他のどの層も
「どの TTS を使うか」「どこに保存するか」を知らない。
テストはこの Container を差し替えるだけで丸ごと制御できる。
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field

from ..application.jobs import JobService
from ..application.render import RenderService
from ..application.voices import VoiceService
from ..infrastructure.artifact_store import FsArtifactStore
from ..infrastructure.audio import FfmpegAudioConverter
from ..infrastructure.clock import SystemClock
from ..infrastructure.panels import HttpPanelFetcher
from ..infrastructure.tts_dummy import DummyTTS
from ..infrastructure.tts_qwen import QwenTTS, dependencies_available
from ..infrastructure.video_ffmpeg import FfmpegVideoRenderer
from ..settings import Settings

log = logging.getLogger("koekomi.container")

VERSION = "2.0.0"


@dataclass
class Warmup:
    """ウォームアップの進行状況。/health が「まだ割り当てないで」と言うために使う。"""

    state: str = "warming"  # warming | ready
    error: str | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)

    def finish(self, error: str | None = None) -> None:
        with self.lock:
            self.state = "ready"
            self.error = error

    @property
    def ready(self) -> bool:
        with self.lock:
            return self.state == "ready"


class Container:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        settings.ensure_dirs()

        self.clock = SystemClock()
        self.warmup = Warmup()

        # --- TTS の選択（唯一ここで決める） --------------------------------
        self.tts_fallback_reason: str | None = None
        self.tts = self._build_tts(settings)

        self.artifacts = FsArtifactStore(
            settings.artifact_dir,
            default_ttl_sec=settings.artifact_ttl_sec,
        )
        self.converter = FfmpegAudioConverter(
            tmp_dir=settings.tmp_dir,
            ffmpeg_bin=settings.ffmpeg_bin,
        )
        self.voices = VoiceService(
            tts=self.tts,
            converter=self.converter,
            clock=self.clock,
            ttl_sec=settings.voice_ttl_sec,
        )
        self.jobs = JobService(
            tts=self.tts,
            voices=self.voices,
            artifacts=self.artifacts,
            clock=self.clock,
            workers=settings.workers,
            max_lines_per_job=settings.max_lines_per_job,
        )
        self.panels = HttpPanelFetcher(
            frontend_origin=settings.frontend_origin,
            cache_dir=settings.cache_dir,
        )
        self.renderer = FfmpegVideoRenderer(
            ffmpeg_bin=settings.ffmpeg_bin,
            font_path=settings.font_path,
            work_dir=settings.tmp_dir,
        )
        self.render = RenderService(
            renderer=self.renderer,
            artifacts=self.artifacts,
            panels=self.panels,
            video_ttl_sec=settings.video_ttl_sec,
        )

    # ---- ライフサイクル ---------------------------------------------------

    def start(self) -> None:
        self.artifacts.start()
        self.jobs.start()
        threading.Thread(target=self._warm, name="warmup", daemon=True).start()

    def stop(self) -> None:
        self.jobs.stop()
        self.artifacts.stop()

    def can_render(self) -> bool:
        """サーバー側で動画を作れるか（フロントはこれを見て書き出し方法を決める）。"""
        return self.render.available and self.panels.configured

    def render_unavailable_reason(self) -> str | None:
        if not self.panels.configured:
            return "FRONTEND_ORIGIN が未設定です"
        return self.render.unavailable_reason

    # ---- 内部 -------------------------------------------------------------

    def _build_tts(self, settings: Settings):
        backend = settings.tts_backend.lower()
        if backend != "qwen":
            if backend != "dummy":
                log.warning("不明な TTS_BACKEND=%s。dummy を使います。", backend)
            return DummyTTS()

        ok, reason = dependencies_available()
        if not ok:
            self.tts_fallback_reason = reason
            log.warning("Qwen3-TTS を使えないため dummy にフォールバックします: %s", reason)
            return DummyTTS()

        import os

        serialize = os.getenv("TTS_SERIALIZE", "1").strip().lower() not in {"0", "false", "no"}
        return QwenTTS(
            model_name=settings.qwen_model,
            language=settings.tts_language,
            serialize=serialize,
        )

    def _warm(self) -> None:
        try:
            self.tts.warmup()
            self.warmup.finish()
            log.info("ウォームアップ完了（モデル読み込み済み）")
        except Exception as e:
            # 失敗しても受付は始める（行ごとに失敗が見えるほうが運用しやすい）。
            self.warmup.finish(error=f"{type(e).__name__}: {e}")
            log.warning("ウォームアップに失敗しました: %s", e)
