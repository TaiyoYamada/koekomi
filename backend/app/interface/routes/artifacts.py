"""GET /artifacts/{id} — 生成物（音声・動画）の配信。

ID は uuid4 で、期限が切れれば実体ごと消える。パスは組み立てず、
ストア側が正規表現で検証した実体だけを返す（パストラバーサルの余地なし）。

ヘッダーを付けられない経路（QRコードのリンク等）のために `?t=` も
受け付ける（security.require_token を参照）。
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from ...infrastructure.artifact_store import MIME_BY_EXT
from ..container import Container
from ..deps import get_container
from ..dto import ArtifactResponse, errors
from ..security import require_token

log = logging.getLogger("koekomi.routes.artifacts")
router = APIRouter(dependencies=[Depends(require_token)])

# クライアント書き出しの動画を預かるときの上限。
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
UPLOADABLE_EXT = {"mp4", "webm"}


# ファイルを返すので JSON ではない。OpenAPI にもそう書く
# （そうしないと生成される型が「JSONが返る」ことになり、契約が嘘になる）。
@router.get(
    "/artifacts/{artifact_id}",
    response_class=FileResponse,
    responses={
        200: {
            "description": "音声（wav）または動画（mp4 / webm）",
            "content": {"audio/wav": {}, "video/mp4": {}, "video/webm": {}},
        },
        **errors(401, 404),
    },
)
async def get_artifact(artifact_id: str, c: Container = Depends(get_container)) -> FileResponse:
    path = c.artifacts.path(artifact_id)
    if path is None:
        raise HTTPException(status_code=404, detail="見つかりません（期限切れかもしれません）。")
    ext = artifact_id.rsplit(".", 1)[-1]
    return FileResponse(
        str(path),
        media_type=MIME_BY_EXT.get(ext, "application/octet-stream"),
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.post(
    "/artifacts",
    status_code=status.HTTP_201_CREATED,
    response_model=ArtifactResponse,
    responses=errors(400, 401, 413),
)
async def upload_artifact(
    c: Container = Depends(get_container),
    video: UploadFile = File(...),
) -> dict:
    """クライアントが書き出した動画を預かる（QRコードで別端末に渡す用）。

    サーバー側レンダリングが使える環境では通らない経路。
    `canRender=false`（フォントが無い等）のときのフォールバック。
    """
    ext = (Path(video.filename or "").suffix or "").lower().lstrip(".")
    if ext not in UPLOADABLE_EXT:
        raise HTTPException(status_code=400, detail="mp4 / webm のみアップロードできます")

    data = await video.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="動画が大きすぎます")

    artifact_id = c.artifacts.put(data, ext=ext, ttl_sec=c.settings.video_ttl_sec)
    log.info("動画を預かりました: %s (%.1f MB)", artifact_id, len(data) / 1024 / 1024)
    return {"artifactId": artifact_id, "expiresSec": c.settings.video_ttl_sec}
