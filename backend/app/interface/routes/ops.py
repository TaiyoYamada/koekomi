"""GET /ops — 運用者（先生・TA）向けの状態。POST /cleanup — 後片付け。

以前は「いま何が起きているか」を見る場所が、端末ごとの localStorage を
覗く /admin しか無かった。20台のiPadが個別に不機嫌になったとき、
運用者に打つ手が無い。サーバー側の事実を1画面にまとめる。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from ..container import VERSION, Container
from ..deps import get_container
from ..dto import CleanupResponse, OpsResponse, errors
from ..security import require_admin_token, require_token

log = logging.getLogger("koekomi.routes.ops")

# /ops は「見るだけ」なので、イベントの合言葉で足りる（先生の /admin 画面が読む）。
router = APIRouter(dependencies=[Depends(require_token)])

# /cleanup は「全員分を消す」ので、フロントに配らない管理者トークンを要求する。
# 合言葉は全 iPad のバンドルに載る＝参加者なら誰でも読めるため、これでは守れない。
admin_router = APIRouter(dependencies=[Depends(require_admin_token)])


@router.get("/ops", response_model=OpsResponse, responses=errors(401))
async def ops(c: Container = Depends(get_container)) -> dict:
    return {
        "version": VERSION,
        "serverId": c.settings.server_id,
        "label": c.settings.server_label,
        "color": c.settings.server_color,
        "warmup": {"state": c.warmup.state, "error": c.warmup.error},
        "tts": {
            "configured": c.settings.tts_backend,
            "effective": c.tts.name,
            "fallbackReason": c.tts_fallback_reason,
            "workers": c.settings.workers,
        },
        "queue": {
            "depth": c.jobs.queue_depth(),
            "activeJobs": c.jobs.active_jobs(),
        },
        "voices": {"enrolled": c.voices.count(), "ttlSec": c.voices.ttl_sec},
        "render": {
            "available": c.can_render(),
            "reason": c.render_unavailable_reason(),
            "frontendOrigin": c.settings.frontend_origin or None,
        },
        "retention": {
            "artifactTtlSec": c.settings.artifact_ttl_sec,
            "videoTtlSec": c.settings.video_ttl_sec,
            "voiceTtlSec": c.settings.voice_ttl_sec,
        },
        "auth": {
            "tokenRequired": bool(c.settings.event_token),
            # 先生の /admin 画面と当日のスモークテストが、後片付けを実行できるか
            # 事前に知れるようにする（イベント後に初めて 503 で気づくのを避ける）。
            "adminConfigured": bool(c.settings.admin_token),
        },
    }


@admin_router.post("/cleanup", response_model=CleanupResponse, responses=errors(401, 503))
async def cleanup(c: Container = Depends(get_container)) -> dict:
    """イベント後の後片付け。声も生成物もまとめて消す。

    `X-Admin-Token` が要る。合言葉では通らない（`require_admin_token` 参照）。
    """
    voices = c.voices.clear()
    artifacts = c.artifacts.clear()
    log.info("後片付けしました: 声 %d 件 / 生成物 %d 件", voices, artifacts)
    return {"voices": voices, "artifacts": artifacts}
