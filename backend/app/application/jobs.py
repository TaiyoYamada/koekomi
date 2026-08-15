"""生成ジョブのワーカープール。

**同時実行の制御はここにある。** 以前は HTTP のルートが `asyncio.Lock` を
取り、`asyncio.wait_for` でタイムアウトさせていた。つまり「GPUは1件ずつ」
というアプリケーションの都合が、トランスポート層に漏れていた。
その層違反がそのままバグ（止まらないスレッド／二重実行）になっていた。

ここでの設計:

- 作業単位は **1行**。ワーカーは1行ずつキューから取り出して処理する。
- キャンセルは **協調的**。「次の行を取り出さない」だけで、走っている
  処理を外から殺さない（Python では殺せないし、殺す必要もない粒度にした）。
- 並列度は設定値 1 つ（`WORKERS`）。GPU 1枚なら 1、余裕があれば増やす。
- ルートは「積む」「覗く」だけ。ビジネス判断を持たない。
"""

from __future__ import annotations

import logging
import queue
import threading
import uuid
from typing import Any

from ..domain.models import ArtifactId, Job, JobId, JobSnapshot, JobState, LineResult, LineTask
from .ports import ArtifactStore, Clock, TTSPort
from .voices import VoiceNotFound, VoiceService

log = logging.getLogger("koekomi.jobs")

# キューに積む終了合図。
_STOP = object()


class JobService:
    def __init__(
        self,
        *,
        tts: TTSPort,
        voices: VoiceService,
        artifacts: ArtifactStore,
        clock: Clock,
        workers: int = 1,
        max_lines_per_job: int = 64,
        keep_jobs: int = 200,
    ) -> None:
        self._tts = tts
        self._voices = voices
        self._artifacts = artifacts
        self._clock = clock
        self._worker_count = max(1, workers)
        self._max_lines = max_lines_per_job
        self._keep_jobs = keep_jobs

        self._lock = threading.Lock()
        self._jobs: dict[JobId, Job] = {}
        self._order: list[JobId] = []  # 投入順。キュー順位の計算に使う。
        self._queue: queue.Queue[Any] = queue.Queue()
        self._threads: list[threading.Thread] = []
        self._running = False

    # ---- ライフサイクル ---------------------------------------------------

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        for i in range(self._worker_count):
            t = threading.Thread(target=self._worker_loop, name=f"tts-worker-{i}", daemon=True)
            t.start()
            self._threads.append(t)
        log.info("ワーカーを %d 本起動しました", self._worker_count)

    def stop(self, timeout: float = 5.0) -> None:
        if not self._running:
            return
        self._running = False
        for _ in self._threads:
            self._queue.put(_STOP)
        for t in self._threads:
            t.join(timeout=timeout)
        self._threads.clear()

    # ---- ユースケース -----------------------------------------------------

    def submit(self, voice_id: str, texts: list[str]) -> JobSnapshot:
        """行を積んでジョブを作る。すぐ返る（処理はワーカーが進める）。"""
        if not texts:
            raise ValueError("セリフがありません。")
        if len(texts) > self._max_lines:
            raise ValueError(f"セリフが多すぎます（{self._max_lines} まで）。")
        # 声が無ければここで弾く（積んでから失敗させない）。
        self._voices.handle(voice_id)

        job_id = uuid.uuid4().hex
        job = Job(
            id=job_id,
            voice_id=voice_id,
            lines=tuple(LineTask(index=i, text=t) for i, t in enumerate(texts)),
            created_at=self._clock.now(),
        )
        with self._lock:
            self._jobs[job_id] = job
            self._order.append(job_id)
            self._forget_old_locked()
        for line in job.lines:
            self._queue.put((job_id, line.index))
        log.info("ジョブを受け付けました: job=%s lines=%d", job_id[:8], len(job.lines))
        return self._snapshot_locked_free(job_id)

    def snapshot(self, job_id: JobId) -> JobSnapshot | None:
        return self._snapshot_locked_free(job_id)

    def cancel(self, job_id: JobId) -> bool:
        """キャンセルを要求する。走っている1行は最後まで走り、その先が止まる。"""
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.state.is_terminal:
                return False
            job.cancel_requested = True
        log.info("ジョブのキャンセルを受け付けました: job=%s", job_id[:8])
        return True

    def queue_depth(self) -> int:
        """まだ処理していない行の総数（/health と /ops で見せる）。"""
        with self._lock:
            return sum(j.total - j.finished for j in self._jobs.values() if j.has_pending_work)

    def active_jobs(self) -> int:
        with self._lock:
            return sum(1 for j in self._jobs.values() if j.has_pending_work)

    # ---- ワーカー ---------------------------------------------------------

    def _worker_loop(self) -> None:
        while True:
            item = self._queue.get()
            if item is _STOP:
                return
            job_id, index = item
            try:
                self._process(job_id, index)
            except Exception:  # ワーカーを絶対に死なせない
                log.exception("ワーカーで想定外の例外が発生しました: job=%s line=%d", job_id[:8], index)
                self._record(job_id, index, LineResult(index=index, error="internal error"))

    def _process(self, job_id: JobId, index: int) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            # キャンセル済み・終了済みなら、この行は処理せず結果だけ埋める。
            if job.cancel_requested or job.state.is_terminal:
                job.results.setdefault(index, LineResult(index=index, error="cancelled"))
                self._finalize_locked(job)
                return
            if job.state is JobState.queued:
                job.state = JobState.running
            text = job.lines[index].text
            voice_id = job.voice_id

        try:
            handle = self._voices.handle(voice_id)
        except VoiceNotFound:
            # 声が期限切れ。この行だけでなくジョブ全体が続行不能。
            self._fail_job(job_id, "声の有効期限が切れました。もう一度録音してください。")
            return

        try:
            wav = self._tts.synthesize(handle, text)
            artifact_id = self._artifacts.put(wav, ext="wav")
        except Exception as e:
            log.warning("行の生成に失敗しました: job=%s line=%d (%s)", job_id[:8], index, e)
            self._record(job_id, index, LineResult(index=index, error=str(e)[:200]))
            return

        # 作品づくりの途中で声が切れないよう、使うたびに期限を延ばす。
        self._voices.touch(voice_id)
        self._record(job_id, index, LineResult(index=index, artifact_id=artifact_id))

    # ---- 内部ヘルパ -------------------------------------------------------

    def _record(self, job_id: JobId, index: int, result: LineResult) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                # ジョブが片付いた後に結果が来た。生成物は sweep で消える。
                if result.artifact_id:
                    log.info("行き先の無い生成物を破棄します: %s", result.artifact_id)
                return
            job.results[index] = result
            self._finalize_locked(job)

    def _fail_job(self, job_id: JobId, message: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.state.is_terminal:
                return
            job.state = JobState.failed
            job.error = message
            for line in job.lines:
                job.results.setdefault(line.index, LineResult(index=line.index, error=message))
        log.warning("ジョブが失敗しました: job=%s (%s)", job_id[:8], message)

    def _finalize_locked(self, job: Job) -> None:
        """全行そろったら終了状態を確定する。呼び出し側がロックを持っていること。"""
        if job.state.is_terminal or job.finished < job.total:
            return
        job.state = JobState.cancelled if job.cancel_requested else JobState.done
        ok = sum(1 for r in job.results.values() if r.ok)
        log.info("ジョブが完了しました: job=%s state=%s ok=%d/%d", job.id[:8], job.state.value, ok, job.total)

    def _forget_old_locked(self) -> None:
        """古い完了ジョブを捨てる（メモリを無限に増やさない）。"""
        while len(self._order) > self._keep_jobs:
            old = self._order.pop(0)
            job = self._jobs.get(old)
            if job is not None and job.has_pending_work:
                # まだ動いているものは捨てない（順番を戻して打ち切る）。
                self._order.insert(0, old)
                return
            self._jobs.pop(old, None)

    def _snapshot_locked_free(self, job_id: JobId) -> JobSnapshot | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            return JobSnapshot(
                id=job.id,
                state=job.state,
                total=job.total,
                finished=job.finished,
                queue_position=self._queue_position_locked(job),
                results=tuple(job.results[i] for i in sorted(job.results)),
                error=job.error,
            )

    def _queue_position_locked(self, job: Job) -> int:
        """自分より前に並んでいて、まだ終わっていないジョブの数。

        0 なら「いま作っているよ」。子どもに見せる待ち順位はこの数字。
        """
        if not job.has_pending_work:
            return 0
        position = 0
        for jid in self._order:
            if jid == job.id:
                break
            other = self._jobs.get(jid)
            if other is not None and other.has_pending_work:
                position += 1
        return position


__all__ = ["ArtifactId", "JobService", "JobSnapshot", "JobState"]
