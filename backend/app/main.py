"""FastAPI アプリ本体。Colab 上で uvicorn により起動する。"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routes import cleanup, files, generate, health

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("vct")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.ensure_dirs()
    # 起動時にバックエンドを解決しておく（フォールバック有無を起動ログに出す）。
    from .services.tts import get_tts

    tts = get_tts().name
    log.info(
        "起動: server=%s color=%s tts=%s(→%s)",
        settings.server_id,
        settings.server_color,
        settings.tts_backend,
        tts,
    )
    if tts == "dummy" and settings.tts_backend != "dummy":
        log.warning("⚠️ TTS が dummy で動作中（Qwen3-TTS が読み込めていません）")
    yield


app = FastAPI(title="コエコミ API", version="1.0.0", lifespan=lifespan)

# CORS: React フロント（固定URL / ngrok / localhost）からアクセスできるように。
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(generate.router)
app.include_router(files.router)
app.include_router(cleanup.router)


@app.get("/")
async def root() -> dict:
    return {"app": "voice-comic-theater", "see": "/health"}
