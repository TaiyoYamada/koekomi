"""HTTP の入出力の形（DTO）。

**ここがフロントとの契約の正**。route に `response_model=` として付けると:

1. OpenAPI に正確なスキーマが載る
   → `scripts/gen-api-types.sh` がフロントの型を生成できる
   → バックエンドを変えてフロントを直し忘れると **型エラーで止まる**
2. FastAPI が返り値を検証する
   → 「うっかり違う形を返した」がテストを待たずに落ちる

以前は全部 `-> dict` で、OpenAPI 上は `additionalProperties: true`（＝何でもあり）
だった。フロントの `apiClient.ts` に同じ形を手書きしていて、二重管理になっていた。
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    """GET /health — フロントの接続先選びが最初に見る。"""

    status: str = Field(description='"ok" か "warming"。warming の間は割り当てない')
    version: str
    serverId: str
    color: str
    label: str
    ttsBackend: str = Field(description="設定値（こう動かしたい）")
    ttsEffective: str = Field(description="実際に動いているもの。dummy ならフォールバック中")
    ttsFallback: str | None = Field(description="dummy に落ちた理由。正常なら null")
    warmupError: str | None
    canRender: bool = Field(description="サーバー側で動画を作れるか")
    queueDepth: int = Field(description="未処理の行数")
    activeJobs: int


class RootResponse(BaseModel):
    app: str
    see: str


class VoiceResponse(BaseModel):
    """POST /voices — 参照音声を1回だけ預けた結果。"""

    voiceId: str
    expiresSec: int


class RemovedResponse(BaseModel):
    removed: bool


class LineResultDTO(BaseModel):
    """1行ぶんの結果。成功なら artifactId、失敗なら error。"""

    index: int
    artifactId: str | None
    error: str | None


class JobResponse(BaseModel):
    """POST /jobs, GET /jobs/{id} — 生成ジョブの状態。"""

    jobId: str
    state: str = Field(description="queued / running / done / failed / cancelled")
    total: int
    finished: int
    queuePosition: int = Field(description="いま一緒に使っている、自分以外の子の数。0 なら独り占め")
    error: str | None
    results: list[LineResultDTO] = Field(description="できた行から順に増える")


class CancelResponse(BaseModel):
    cancelled: bool


class ArtifactResponse(BaseModel):
    artifactId: str
    expiresSec: int


class WarmupDTO(BaseModel):
    state: str
    error: str | None


class TtsDTO(BaseModel):
    configured: str
    effective: str
    fallbackReason: str | None
    workers: int


class QueueDTO(BaseModel):
    depth: int
    activeJobs: int


class VoicesDTO(BaseModel):
    enrolled: int
    ttlSec: int


class RenderDTO(BaseModel):
    available: bool
    reason: str | None
    frontendOrigin: str | None


class RetentionDTO(BaseModel):
    artifactTtlSec: int
    videoTtlSec: int
    voiceTtlSec: int


class AuthDTO(BaseModel):
    tokenRequired: bool
    # /cleanup が使える状態か（ADMIN_TOKEN が設定されているか）。
    adminConfigured: bool


class OpsResponse(BaseModel):
    """GET /ops — 運用者（先生・TA）が見る状態。"""

    version: str
    serverId: str
    label: str
    color: str
    warmup: WarmupDTO
    tts: TtsDTO
    queue: QueueDTO
    voices: VoicesDTO
    render: RenderDTO
    retention: RetentionDTO
    auth: AuthDTO


class CleanupResponse(BaseModel):
    voices: int
    artifacts: int


# ---- エラー応答の宣言 --------------------------------------------------------
#
# フロントは 409（声の期限切れ→録り直しを促す）や 503（この台では動画を作れない
# →クライアント書き出しに落とす）で**分岐している**。分岐の根拠がスキーマに
# 載っていないと、契約として不完全（実際 schemathesis に指摘された）。


class ErrorResponse(BaseModel):
    """FastAPI の HTTPException が返す形。

    注意: 422（バリデーションエラー）だけは FastAPI が `HTTPValidationError`
    として自前で定義しており、`detail` が **配列** になる。ここで上書きすると
    契約が嘘になるので、422 は宣言しない（schemathesis に指摘されて気づいた）。
    """

    detail: str


def errors(*codes: int) -> dict[int | str, dict]:
    """route の `responses=` に渡すエラー定義を作る。"""
    known = {
        400: "入力が不正",
        401: "合言葉が違う（/cleanup は管理者トークンが違う）",
        404: "見つからない（期限切れを含む）",
        409: "いまの状態では実行できない（声の期限切れ・音声の欠落）",
        413: "大きすぎる",
        503: "この環境では利用できない（クライアント側へフォールバック／未設定で無効）",
    }
    return {code: {"model": ErrorResponse, "description": known.get(code, "エラー")} for code in codes}
