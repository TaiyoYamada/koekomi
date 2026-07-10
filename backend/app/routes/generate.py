"""POST /generate-comic-voices — セリフぶんのAI音声を生成する。

受け取るもの:
- audio          : 録音音声（声の参照）
- reference_text : 参照テキスト（録音で読み上げた固定スクリプトの文）
- lines          : セリフ（可変個数。同じキーで複数送る）

返すもの: lines と同じ順番の音声ファイル名リスト。

generation_lock を取得してから処理するので、
1つのColabでは音声生成が同時に複数走らない（1件ずつ順番に処理）。
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..config import settings
from ..locks import generation_lock
from ..services.audio import convert_to_wav, save_upload
from ..services.tts import synthesize_lines

log = logging.getLogger("vct.routes.generate")
router = APIRouter()


@router.post("/generate-comic-voices")
async def generate_comic_voices(
    audio: UploadFile = File(...),
    reference_text: str = Form(""),
    lines: list[str] = Form(default=[]),
) -> dict:
    data = await audio.read()
    suffix = Path(audio.filename or "ref").suffix or ".webm"
    src = save_upload(data, suffix=suffix)
    ref_wav = convert_to_wav(src)

    try:
        # 1つのColabにつき生成は1件ずつ。混雑時は順番待ちになる。
        async with generation_lock:
            log.info("音声生成を開始: %d 件", len(lines))
            try:
                # タイムアウトを付ける。詰まっても wait_for が抜けることで
                # async with がロックを解放するので、後続のリクエストを無限に待たせない。
                files = await asyncio.wait_for(
                    synthesize_lines(
                        reference_audio=ref_wav,
                        reference_text=reference_text,
                        lines=list(lines),
                    ),
                    timeout=settings.gen_timeout_sec,
                )
            except asyncio.TimeoutError:
                log.error("音声生成がタイムアウトしました（%d 秒）", settings.gen_timeout_sec)
                raise HTTPException(
                    status_code=504,
                    detail="音声生成がタイムアウトしました。もう一度お試しください。",
                ) from None
            log.info("音声生成が完了: %s", files)
    finally:
        # 子どもの声（参照録音）はこのリクエスト限りの素材。使い終わったら必ず消す
        # （生成した音声は再生に必要なので output に残す）。
        for p in {src, ref_wav}:
            try:
                p.unlink(missing_ok=True)
            except OSError:
                log.warning("参照録音の一時ファイルを削除できませんでした: %s", p)

    return {"files": files}
