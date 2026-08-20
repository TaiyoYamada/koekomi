"""GET /health — 生存確認。フロントの接続先選びが最初に見る。

認証は掛けない（接続できるかの確認そのものなので）。
代わりに、内部の詳細は出さない。

`status` が "warming" の間、フロントはこのサーバーを選ばない。
以前はモデル読み込み中でも "ok" を返していたので、起動途中の台に
当たった子だけが数分待たされていた。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..container import VERSION, Container
from ..deps import get_container
from ..dto import HealthResponse, RootResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health(c: Container = Depends(get_container)) -> dict:
    warm = c.warmup
    return {
        "status": "ok" if warm.ready else "warming",
        "version": VERSION,
        "serverId": c.settings.server_id,
        "color": c.settings.server_color,
        "label": c.settings.server_label,
        # 設定値（こう動かしたい）
        "ttsBackend": c.settings.tts_backend,
        # 実際に動いているもの（dummy ならフォールバック中）
        "ttsEffective": c.tts.name,
        "ttsFallback": c.tts_fallback_reason,
        "warmupError": warm.error,
        # 動画をサーバーで作れるか。false ならフロントが自前で書き出す。
        "canRender": c.can_render(),
        # 待ち具合（子どもに見せる順位はジョブ側で持つ。これは運用者向け）
        "queueDepth": c.jobs.queue_depth(),
        "activeJobs": c.jobs.active_jobs(),
        # この台を実際に使っている子の人数。
        # 「何台つながっているか」はサーバーには分からない（名簿から選んで
        # /health を叩くだけの端末は、こちらから見えない）。声を預けた時点で
        # 初めてサーバーの事実になるので、それを人数として出す。
        # 端末側に presence を持たせないのは ADR 0001 の決定のまま。
        "voicesEnrolled": c.voices.count(),
    }


@router.get("/", response_model=RootResponse)
async def root() -> dict:
    return {"app": "koekomi", "see": "/health"}
