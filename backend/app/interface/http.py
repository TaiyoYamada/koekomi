"""FastAPI アプリの組み立て。"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..settings import Settings
from .container import VERSION, Container
from .routes import artifacts, health, jobs, ops, render, voices

log = logging.getLogger("koekomi")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        container = Container(settings)
        app.state.container = container
        _log_startup(container)
        container.start()
        try:
            yield
        finally:
            container.stop()

    app = FastAPI(title="コエコミ API", version=VERSION, lifespan=lifespan)

    # CORS: 既定は localhost のみ。本番は CORS_ORIGINS を必ず設定する。
    # 以前の既定は "*" で、設定し忘れても本番で気づけなかった。
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_list(),
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(voices.router)
    app.include_router(jobs.router)
    app.include_router(artifacts.router)
    app.include_router(render.router)
    app.include_router(ops.router)
    return app


def _log_startup(c: Container) -> None:
    s = c.settings
    log.info(
        "起動: server=%s color=%s tts=%s(→%s) workers=%d",
        s.server_id,
        s.server_color,
        s.tts_backend,
        c.tts.name,
        s.workers,
    )
    if c.tts.name == "dummy" and s.tts_backend != "dummy":
        log.warning("⚠️ TTS が dummy で動作中（Qwen3-TTS を読み込めていません）: %s", c.tts_fallback_reason)
    if not s.event_token:
        log.warning("⚠️ EVENT_TOKEN が未設定です。誰でもこのAPIを叩けます（本番では必ず設定）。")
    if s.cors_list() == ["*"]:
        log.warning("⚠️ CORS_ORIGINS が * です。本番ではフロントのオリジンに固定してください。")
    if not c.can_render():
        log.warning(
            "動画のサーバー側レンダリングは使えません（クライアント書き出しになります）: %s",
            c.render_unavailable_reason(),
        )
