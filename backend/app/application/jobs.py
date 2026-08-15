"""生成ジョブのスケジューラとワーカープール。

**同時実行の制御はここにある。** 以前は HTTP のルートが `asyncio.Lock` を
取り、`asyncio.wait_for` でタイムアウトさせていた。つまり「GPUは1件ずつ」
というアプリケーションの都合が、トランスポート層に漏れていた。
その層違反がそのままバグ（止まらないスレッド／二重実行）になっていた。

ここでの設計:

- 作業単位は **1行**。ワーカーは1行ずつ取り出して処理する。
- 取り出す順は **ラウンドロビン**（子どもごとに1行ずつ交代）。
- キャンセルは **協調的**。「次の行を取り出さない」だけで、走っている
  処理を外から殺さない（Python では殺せないし、殺す必要もない粒度にした）。
- 並列度は設定値 1 つ（`WORKERS`）。GPU 1枚なら 1、余裕があれば増やす。
- ルートは「積む」「覗く」だけ。ビジネス判断を持たない。

■ なぜ FIFO をやめたか（負荷テストで分かったこと）

    10人 × 8セリフ、1行1.5秒、ワーカー1本で `scripts/load-test.py` を回すと、
    ジョブ単位の FIFO では **最後の子は最初の1行が返るまで108秒** かかった
    （前の9人ぶん72行が先に全部処理されるため）。全体の所要時間は同じでも、
    子どもの体感はまったく違う。

    1行ずつ交代にすると、**全員の1行目が最初の10行以内に返る**。
    進捗バーが全員同時に動き始めるので「自分の番が来ていない」時間が消える。
    総処理時間は変わらないのに、体感待ち時間だけが劇的に縮む。
"""

from __future__ import annotations

import contextlib
import logging
import threading
import time
import uuid
from collections import deque

from ..domain.models import ArtifactId, Job, JobId, JobSnapshot, JobState, LineResult, LineTask
from .ports import ArtifactStore, Clock, TTSPort
from .voices import VoiceNotFound, VoiceService

log = logging.getLogger("koekomi.jobs")


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

        # 状態と待ち合わせを1つの条件変数で守る。
        self._cv = threading.Condition()
        self._jobs: dict[JobId, Job] = {}
        self._order: list[JobId] = []  # 投入順。キュー順位の計算に使う。
        # ラウンドロビンの回転列。まだ配っていない行を持つジョブだけが並ぶ。
        self._rotation: deque[JobId] = deque()
        # ジョブごとの「次に配る行」。
        self._next_index: dict[JobId, int] = {}

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
        with self._cv:
            self._running = False
            self._cv.notify_all()
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
        with self._cv:
            self._jobs[job_id] = job
            self._order.append(job_id)
            self._next_index[job_id] = 0
            self._rotation.append(job_id)
            self._forget_old_locked()
            self._cv.notify_all()
            snapshot = self._snapshot_locked(job)
        log.info("ジョブを受け付けました: job=%s lines=%d", job_id[:8], len(job.lines))
        return snapshot

    def snapshot(self, job_id: JobId) -> JobSnapshot | None:
        with self._cv:
            job = self._jobs.get(job_id)
            return self._snapshot_locked(job) if job else None

    def cancel(self, job_id: JobId) -> bool:
        """キャンセルを要求する。走っている1行は最後まで走り、その先が止まる。"""
        with self._cv:
            job = self._jobs.get(job_id)
            if job is None or job.state.is_terminal:
                return False
            job.cancel_requested = True
            # 未配布の行はここで結果を埋めてしまう（配らずに終わらせる）。
            for i in range(self._next_index.get(job_id, 0), job.total):
                job.results.setdefault(i, LineResult(index=i, error="cancelled"))
            self._next_index[job_id] = job.total
            self._remove_from_rotation_locked(job_id)
            self._finalize_locked(job)
        log.info("ジョブのキャンセルを受け付けました: job=%s", job_id[:8])
        return True

    def queue_depth(self) -> int:
        """まだ処理していない行の総数（/health と /ops で見せる）。"""
        with self._cv:
            return sum(j.total - j.finished for j in self._jobs.values() if j.has_pending_work)

    def active_jobs(self) -> int:
        with self._cv:
            return sum(1 for j in self._jobs.values() if j.has_pending_work)

    # ---- ワーカー ---------------------------------------------------------

    def _worker_loop(self) -> None:
        while True:
            claimed = self._claim_next()
            if claimed is None:
                return  # stop() された
            job_id, index, text, voice_id = claimed
            try:
                self._process(job_id, index, text, voice_id)
            except Exception:  # ワーカーを絶対に死なせない
                log.exception("ワーカーで想定外の例外: job=%s line=%d", job_id[:8], index)
                self._record(job_id, index, LineResult(index=index, error="internal error"))

    def _claim_next(self) -> tuple[JobId, int, str, str] | None:
        """次に処理する1行を、ラウンドロビンで1つ取り出す。

        取り出したジョブは列の最後尾へ回す。これにより、行数の多い子が
        後続を待たせ続けることがなくなる。
        """
        with self._cv:
            while True:
                while self._running and not self._rotation:
                    self._cv.wait()
                if not self._running:
                    return None

                job_id = self._rotation.popleft()
                job = self._jobs.get(job_id)
                index = self._next_index.get(job_id, 0)

                # 片付いた・キャンセルされた・配り終えたジョブは黙って捨てて次へ。
                if job is None or job.state.is_terminal or index >= job.total:
                    self._next_index.pop(job_id, None)
                    continue

                self._next_index[job_id] = index + 1
                if index + 1 < job.total:
                    self._rotation.append(job_id)  # まだ残っているので最後尾へ
                if job.state is JobState.queued:
                    job.state = JobState.running
                return job_id, index, job.lines[index].text, job.voice_id

    def _process(self, job_id: JobId, index: int, text: str, voice_id: str) -> None:
        try:
            handle = self._voices.handle(voice_id)
        except VoiceNotFound:
            # 声が期限切れ。この行だけでなくジョブ全体が続行不能。
            self._fail_job(job_id, "声の有効期限が切れました。もう一度録音してください。")
            return

        started = time.perf_counter()
        try:
            wav = self._tts.synthesize(handle, text)
            artifact_id = self._artifacts.put(wav, ext="wav")
        except Exception as e:
            log.warning("行の生成に失敗: job=%s line=%d (%s)", job_id[:8], index, e)
            self._record(job_id, index, LineResult(index=index, error=str(e)[:200]))
            return

        # 1行あたりの所要時間を残す（イベント後の集計と、次回の台数見積もりに使う）。
        # セリフの本文は出さない。長さだけ。
        log.info(
            "行を生成しました",
            extra={
                "event": {
                    "job": job_id[:8],
                    "line": index,
                    "lineSec": round(time.perf_counter() - started, 3),
                    "chars": len(text),
                }
            },
        )

        # 作品づくりの途中で声が切れないよう、使うたびに期限を延ばす。
        self._voices.touch(voice_id)
        self._record(job_id, index, LineResult(index=index, artifact_id=artifact_id))

    # ---- 内部ヘルパ -------------------------------------------------------

    def _record(self, job_id: JobId, index: int, result: LineResult) -> None:
        with self._cv:
            job = self._jobs.get(job_id)
            if job is None:
                # ジョブが片付いた後に結果が来た。生成物は sweep で消える。
                if result.artifact_id:
                    log.info("行き先の無い生成物を破棄します: %s", result.artifact_id)
                return
            job.results.setdefault(index, result)
            self._finalize_locked(job)

    def _fail_job(self, job_id: JobId, message: str) -> None:
        with self._cv:
            job = self._jobs.get(job_id)
            if job is None or job.state.is_terminal:
                return
            job.state = JobState.failed
            job.error = message
            for line in job.lines:
                job.results.setdefault(line.index, LineResult(index=line.index, error=message))
            self._next_index[job_id] = job.total
            self._remove_from_rotation_locked(job_id)
        log.warning("ジョブが失敗しました: job=%s (%s)", job_id[:8], message)

    def _remove_from_rotation_locked(self, job_id: JobId) -> None:
        with contextlib.suppress(ValueError):
            self._rotation.remove(job_id)

    def _finalize_locked(self, job: Job) -> None:
        """全行そろったら終了状態を確定する。呼び出し側がロックを持っていること。"""
        if job.state.is_terminal or job.finished < job.total:
            return
        job.state = JobState.cancelled if job.cancel_requested else JobState.done
        ok = sum(1 for r in job.results.values() if r.ok)
        log.info(
            "ジョブが完了しました: job=%s state=%s ok=%d/%d",
            job.id[:8],
            job.state.value,
            ok,
            job.total,
        )

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
            self._next_index.pop(old, None)

    def _snapshot_locked(self, job: Job) -> JobSnapshot:
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
        """いま一緒に使っている、自分以外の子の数。

        ラウンドロビンなので「前が全部終わるまで待つ」ではない。
        全員が同時に進み、この数だけ1行あたりが遅くなる、という意味になる。
        0 なら独り占め。
        """
        if not job.has_pending_work:
            return 0
        return sum(1 for j in self._jobs.values() if j.id != job.id and j.has_pending_work)


__all__ = ["ArtifactId", "JobService", "JobSnapshot", "JobState"]
