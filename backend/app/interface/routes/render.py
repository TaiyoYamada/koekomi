"""POST /render — タイムラインから動画を作る。

クライアントは「再生に使っているのと同じタイムライン」をそのまま送る。
プレビューと動画が一致することが構造で保証される（計算を二重に持たない）。
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ...application.render import RenderFailed, RenderUnavailable
from ...domain.timeline import MAX_SEGMENTS, InvalidTimeline, Segment, validate
from ..container import Container
from ..deps import get_container
from ..dto import ArtifactResponse, errors
from ..security import require_token

log = logging.getLogger("koekomi.routes.render")
router = APIRouter(dependencies=[Depends(require_token)])


class SegmentDTO(BaseModel):
    startMs: int = Field(ge=0)
    durMs: int = Field(gt=0)
    panelPath: str | None = None
    subtitle: str = ""
    artifactId: str | None = None


class RenderRequest(BaseModel):
    segments: list[SegmentDTO] = Field(min_length=1, max_length=MAX_SEGMENTS)


@router.post(
    "/render",
    status_code=status.HTTP_201_CREATED,
    response_model=ArtifactResponse,
    responses=errors(400, 401, 409, 503),
)
async def render_video(req: RenderRequest, c: Container = Depends(get_container)) -> dict:
    try:
        timeline = validate(
            [
                Segment(
                    start_ms=s.startMs,
                    dur_ms=s.durMs,
                    panel_path=s.panelPath,
                    subtitle=s.subtitle,
                    artifact_id=s.artifactId,
                )
                for s in req.segments
            ]
        )
    except InvalidTimeline as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    try:
        # ffmpeg は CPU 仕事。イベントループを止めないよう別スレッドへ。
        # TTS のワーカープールとは別枠なので、音声生成を待たせない。
        artifact_id, ttl = await asyncio.to_thread(c.render.render, timeline)
    except RenderUnavailable as e:
        # フロントは canRender=false を見て自前書き出しに切り替える。
        raise HTTPException(status_code=503, detail=str(e)) from e
    except RenderFailed as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except Exception as e:
        log.exception("レンダリングに失敗しました")
        raise HTTPException(status_code=500, detail="動画を作れませんでした。") from e

    return {"artifactId": artifact_id, "expiresSec": ttl}
