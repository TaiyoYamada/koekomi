"""FastAPI アプリ本体。Colab 上で uvicorn により起動する。"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .locks import generation_lock
from .routes import cleanup, files, generate, health

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("vct")


async def _warmup() -> None:
    """起動後すぐ、背景でモデルを読み込んでおく（初回リクエストの数分待ちを無くす）。

    生成と同じ generation_lock を取ってから読み込むので、本番リクエストと
    モデル読み込みが二重に走ることはない（先に来たリクエストが読み込めば、
    こちらは即終わる）。
    """
    from .services.tts import get_tts

    try:
        async with generation_lock:
            await get_tts().warmup()
        log.info("ウォームアップ完了（モデル読み込み済み）")
    except Exception as e:  # 失敗してもサーバーは動かす（初回リクエストで再試行される）。
        log.warning("ウォームアップに失敗しました（初回リクエストで読み込みます）: %s", e)


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
    # 背景でウォームアップ（lifespan はブロックしないので /health はすぐ応答する）。
    asyncio.create_task(_warmup())
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
    return {"app": "koekomi", "see": "/health"}
