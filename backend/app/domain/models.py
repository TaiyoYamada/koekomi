"""ドメインモデル。

設計の中心にあるのは **「作業単位は1行（1セリフ）」** という決定。

以前は「16行まとめて1リクエスト」だったため、詰まったときに
`asyncio.wait_for` で中断しようとしていた。しかし重い処理は別スレッドで
動いており、Python のスレッドは外から止められない。結果として
「タイムアウトしたのにGPU上では処理が走り続け、解放されたロックに
次のリクエストが入って二重実行になる」という壊れ方をしていた。

作業単位を1行（数秒）にすると、この問題自体が消える。
キャンセルは「次の行を取り出さない」だけでよく、強制中断が要らない。
最大待ち時間は1行ぶん。これは実装の工夫ではなく、モデルの選択で
バグの発生余地を無くしたということ。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

# --- 識別子 -----------------------------------------------------------------
# すべて不透明な文字列。外に出るのはこれだけで、ファイルパスは決して漏らさない。
VoiceId = str
JobId = str
ArtifactId = str


class JobState(str, Enum):
    """ジョブの状態。`str` を継承しているので JSON にそのまま出せる。"""

    queued = "queued"
    running = "running"
    done = "done"  # 全行が終わった（一部失敗していても done。中身は results を見る）
    failed = "failed"  # ジョブ自体が始められなかった（声が期限切れ等）
    cancelled = "cancelled"

    @property
    def is_terminal(self) -> bool:
        return self in (JobState.done, JobState.failed, JobState.cancelled)


@dataclass(frozen=True)
class LineTask:
    """生成する1行。index はクライアントが送った並び順で、返却時の対応づけに使う。"""

    index: int
    text: str


@dataclass(frozen=True)
class LineResult:
    """1行の結果。成功なら artifact_id、失敗なら error が入る。

    「全部成功か全部失敗か」ではなく行ごとに持つので、
    16行中1行だけ失敗しても残り15行は使える（部分成功）。
    """

    index: int
    artifact_id: ArtifactId | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.artifact_id is not None


@dataclass
class Job:
    """生成ジョブ。JobService のロック下でのみ変更する（外へは snapshot を返す）。"""

    id: JobId
    voice_id: VoiceId
    lines: tuple[LineTask, ...]
    created_at: float
    results: dict[int, LineResult] = field(default_factory=dict)
    state: JobState = JobState.queued
    error: str | None = None
    cancel_requested: bool = False

    @property
    def total(self) -> int:
        return len(self.lines)

    @property
    def finished(self) -> int:
        return len(self.results)

    @property
    def has_pending_work(self) -> bool:
        """まだワーカーが処理すべき行が残っているか。"""
        return not self.state.is_terminal and self.finished < self.total


@dataclass(frozen=True)
class JobSnapshot:
    """API に返す読み取り専用のジョブ状態。

    Job をそのまま返すと呼び出し側が書き換えられてしまうので、
    境界では必ずこの不変スナップショットに詰め替える。
    """

    id: JobId
    state: JobState
    total: int
    finished: int
    queue_position: int
    results: tuple[LineResult, ...]
    error: str | None = None

    @property
    def failed_lines(self) -> tuple[LineResult, ...]:
        return tuple(r for r in self.results if not r.ok)
