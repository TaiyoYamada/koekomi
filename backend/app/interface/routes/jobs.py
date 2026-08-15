"""POST /jobs, GET /jobs/{id}, POST /jobs/{id}/cancel — 音声生成ジョブ。

以前は「16行を1リクエストで、最大210秒ブロックして待つ」形だった。
iOS Safari は画面ロックやタブ移動で進行中の fetch を平然と切るので、
3分間の同期リクエストは実質コイントスだった。しかもリロードすると
サーバー上に生成済みの音声があるのに、クライアントは全部失っていた。

ジョブにしたことで:
  - 202 を即返す（切れても jobId で追える）
  - 1行できるごとに結果が返る（部分成功・先に1コマ目が再生できる）
  - 待ち順位が出せる（3分の無言スピナーより、3人待ちのほうが耐えられる）
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from ...application.voices import VoiceNotFound
from ...domain.models import JobSnapshot
from ..container import Container
from ..deps import get_container
from ..security import require_token

log = logging.getLogger("koekomi.routes.jobs")
router = APIRouter(dependencies=[Depends(require_token)])


class CreateJobRequest(BaseModel):
    voiceId: str = Field(min_length=1)
    lines: list[str]


def _to_dto(snap: JobSnapshot) -> dict:
    return {
        "jobId": snap.id,
        "state": snap.state.value,
        "total": snap.total,
        "finished": snap.finished,
        # 0 なら「いま作っているよ」。子どもに見せる待ち順位。
        "queuePosition": snap.queue_position,
        "error": snap.error,
        "results": [{"index": r.index, "artifactId": r.artifact_id, "error": r.error} for r in snap.results],
    }


@router.post("/jobs", status_code=status.HTTP_202_ACCEPTED)
async def create_job(req: CreateJobRequest, c: Container = Depends(get_container)) -> dict:
    try:
        snap = c.jobs.submit(req.voiceId, req.lines)
    except VoiceNotFound as e:
        raise HTTPException(
            status_code=409,
            detail="声の有効期限が切れました。もう一度録音してください。",
        ) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return _to_dto(snap)


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, response: Response, c: Container = Depends(get_container)) -> dict:
    snap = c.jobs.snapshot(job_id)
    if snap is None:
        raise HTTPException(status_code=404, detail="ジョブが見つかりません。")
    # ポーリング前提なのでキャッシュさせない。
    response.headers["Cache-Control"] = "no-store"
    return _to_dto(snap)


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str, c: Container = Depends(get_container)) -> dict:
    """キャンセルを要求する。走っている1行は最後まで走り、その先が止まる。"""
    return {"cancelled": c.jobs.cancel(job_id)}
