// 声のエンロールと生成ジョブのライフサイクル。**React の外**に置く。
//
// ここが React の外にあることの意味:
//   - タブを移動してもジョブが切れない（以前は全画面をマウントしたまま
//     hidden で隠すという回避策でこれを実現していた）
//   - ページをリロードしても jobId で追いつける（以前は 210秒の同期POSTで、
//     切れたらサーバー上に音声があるのに全部失っていた）
//   - 「AI音声を生成する」というユースケースが1箇所にある（以前は
//     GenerateVoices.tsx と VoiceTryout.tsx に二重実装されていた）

import { REFERENCE_SCRIPT } from '../domain/script'
import { meaningfulLines } from '../domain/work'
import type { LineId } from '../domain/work'
import {
  ApiError,
  cancelJob,
  createJob,
  enrollVoice,
  fetchArtifact,
  fetchJob,
  forgetVoice,
  type JobStatus,
} from '../infrastructure/apiClient'
import { getAudio, REFERENCE_KEY, TRYOUT_PREFIX } from '../infrastructure/idb'
import { forgetAudio, storeAudio, useAudioUrl } from './audioUrls'
import { getAssignment } from './connection'
import { createStore, useStore } from './store'
import { getWork, workActions } from './workStore'

/** お試し音声のキー。 */
const tryoutKey = (phrase: string) => `${TRYOUT_PREFIX}${phrase}`

/** 中断したジョブを引き継ぐための控え。 */
const LS_JOB = 'koekomi.job'

/**
 * ジョブの進み具合を見に行く間隔。
 *
 * テストから縮めるための継ぎ目としてオブジェクトにしている
 * （実時間で1秒待つテストを何本も並べたくないため）。本番では触らない。
 */
export const timing = { pollMs: 1000 }

// ---- 状態 -------------------------------------------------------------------

export interface VoiceState {
  /** 参照録音が手元にあるか。 */
  hasRecording: boolean
  /** サーバーに覚えさせた声のID。サーバーが変わると無効。 */
  voiceId: string | null
  voiceServerId: string | null
  enrolling: boolean
  error: string | null
}

export type GenPhase = 'idle' | 'queued' | 'running' | 'saving' | 'done' | 'failed' | 'cancelled'

export interface GenerationState {
  phase: GenPhase
  jobId: string | null
  total: number
  finished: number
  /** 0 なら「いま作っているよ」。1以上なら「あと○にんまち」。 */
  queuePosition: number
  failedLines: number
  error: string | null
}

const idleGeneration: GenerationState = {
  phase: 'idle',
  jobId: null,
  total: 0,
  finished: 0,
  queuePosition: 0,
  failedLines: 0,
  error: null,
}

export const voiceStore = createStore<VoiceState>({
  hasRecording: false,
  voiceId: null,
  voiceServerId: null,
  enrolling: false,
  error: null,
})

export const generationStore = createStore<GenerationState>(idleGeneration)

/** お試し音声（プリセット文 → 準備できたか）。 */
export const tryoutStore = createStore<{
  ready: Record<string, boolean>
  busy: boolean
  error: boolean
}>({
  ready: {},
  busy: false,
  error: false,
})

export const useVoice = () => useStore(voiceStore, (s) => s)
export const useGeneration = () => useStore(generationStore, (s) => s)
export const useTryout = () => useStore(tryoutStore, (s) => s)

/** 生成中は録り直し等を止める（負荷を増やさない）。 */
export function isBusy(): boolean {
  const g = generationStore.get().phase
  return g === 'queued' || g === 'running' || g === 'saving' || tryoutStore.get().busy
}

// ---- 参照録音 ---------------------------------------------------------------

/** 参照録音を再生するためのURL（録音済みのときだけ）。 */
export function useReferenceAudioUrl(hasRecording: boolean): string | null {
  return useAudioUrl(hasRecording ? { kind: 'stored', key: REFERENCE_KEY } : undefined)
}

/** 起動時に、保存済みの参照録音があるか調べる。 */
export async function restoreRecording(): Promise<void> {
  const blob = await getAudio(REFERENCE_KEY)
  if (blob) voiceStore.set((s) => ({ ...s, hasRecording: true }))
}

/** 録音できたら呼ぶ。声は覚え直しになる。 */
export async function setReferenceRecording(blob: Blob): Promise<void> {
  await storeAudio(REFERENCE_KEY, blob)
  const previous = voiceStore.get()
  voiceStore.set({
    hasRecording: true,
    voiceId: null,
    voiceServerId: null,
    enrolling: false,
    error: null,
  })
  // 古い声で作ったお試しは無効。
  for (const phrase of Object.keys(tryoutStore.get().ready)) void forgetAudio(tryoutKey(phrase))
  tryoutStore.set({ ready: {}, busy: false, error: false })

  // 前の声はサーバーに残さない（子どもの声を必要以上に預けない）。
  const assignment = getAssignment()
  if (previous.voiceId && assignment && previous.voiceServerId === assignment.serverId) {
    void forgetVoice(assignment.apiUrl, previous.voiceId)
  }
}

// ---- エンロール -------------------------------------------------------------

/**
 * サーバーにこの子の声を覚えさせる（1人1回）。
 * すでに同じサーバーで覚えていれば何もしない。
 * サーバーが変わっていたら覚え直す（フェイルオーバー対応）。
 */
export async function ensureVoice(): Promise<string | null> {
  const assignment = getAssignment()
  if (!assignment) return null

  const current = voiceStore.get()
  if (current.voiceId && current.voiceServerId === assignment.serverId) return current.voiceId

  const blob = await getAudio(REFERENCE_KEY)
  if (!blob) return null

  voiceStore.set((s) => ({ ...s, enrolling: true, error: null }))
  try {
    const { voiceId } = await enrollVoice(assignment.apiUrl, blob, REFERENCE_SCRIPT)
    voiceStore.set((s) => ({
      ...s,
      voiceId,
      voiceServerId: assignment.serverId,
      enrolling: false,
      error: null,
    }))
    return voiceId
  } catch (e) {
    console.error(e) // 詳細は画面に出さず、コンソールにだけ残す。
    voiceStore.set((s) => ({ ...s, enrolling: false, error: 'こえを おぼえられなかったよ。' }))
    return null
  }
}

// ---- 生成ジョブ -------------------------------------------------------------

let pollTimer: ReturnType<typeof setInterval> | null = null
/**
 * ポーリングの世代。
 *
 * ポーリングは `void pollOnce()` で投げっぱなしにするので、interval を止めても
 * **進行中の1回が後から結果を書き戻す**ことがある。声を録り直した直後や
 * 次の子にリセットした直後に、前のジョブの状態が画面に出てしまう。
 * 各回は自分の世代を覚えておき、世代が変わっていたら何も書かない。
 */
let pollGeneration = 0
/**
 * ポーリングが重ならないようにする印。
 *
 * 音声のダウンロードと IndexedDB への保存を待っている間に次のポーリングが
 * 始まると、**まだ保存し終えていないのに「できたよ」と表示される**。
 * 1回が終わるまで次を始めない。
 */
let polling = false
/** 結果の index → どの行か。ジョブ投入時に確定させる。 */
let lineMap: LineId[] = []
/** 二重ダウンロードを防ぐ。 */
let downloaded = new Set<number>()

function stopPolling(): void {
  pollGeneration++
  polling = false
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function rememberJob(jobId: string, lines: LineId[], serverId: string): void {
  try {
    localStorage.setItem(LS_JOB, JSON.stringify({ jobId, lines, serverId }))
  } catch {
    // 控えられなくても、そのセッション中は動く。
  }
}

function clearRememberedJob(): void {
  localStorage.removeItem(LS_JOB)
}

/**
 * 書いてあるセリフ全部のAI音声を作る。
 * 送るのはテキストだけ（参照音声は ensureVoice で1回送り済み）。
 */
export async function generateVoices(): Promise<void> {
  const assignment = getAssignment()
  if (!assignment) return

  const targets = meaningfulLines(getWork()).filter(({ line }) => line.text.trim())
  if (targets.length === 0) return

  generationStore.set({ ...idleGeneration, phase: 'queued', total: targets.length })

  const voiceId = await ensureVoice()
  if (!voiceId) {
    generationStore.set((s) => ({ ...s, phase: 'failed', error: 'さきに こえを ろくおんしてね。' }))
    return
  }

  lineMap = targets.map(({ line }) => line.id)
  downloaded = new Set()

  try {
    const job = await createJob(
      assignment.apiUrl,
      voiceId,
      targets.map(({ line }) => line.text),
    )
    rememberJob(job.jobId, lineMap, assignment.serverId)
    generationStore.set((s) => ({ ...s, jobId: job.jobId, phase: 'running' }))
    startPolling(job.jobId)
  } catch (e) {
    handleSubmitError(e)
  }
}

function handleSubmitError(e: unknown): void {
  console.error(e)
  // 409 = 声の期限切れ。もう一度録音してもらう必要がある。
  if (e instanceof ApiError && e.status === 409) {
    voiceStore.set((s) => ({ ...s, voiceId: null, voiceServerId: null }))
    generationStore.set((s) => ({
      ...s,
      phase: 'failed',
      error: 'こえの じかんが きれたよ。もういちど ろくおんしてね。',
    }))
    return
  }
  generationStore.set((s) => ({
    ...s,
    phase: 'failed',
    error: 'うまくいかなかったよ。もう一度 ためしてね。',
  }))
}

function startPolling(jobId: string): void {
  stopPolling()
  const token = pollGeneration
  pollTimer = setInterval(() => void pollOnce(jobId, token), timing.pollMs)
  void pollOnce(jobId, token)
}

async function pollOnce(jobId: string, token: number): Promise<void> {
  if (polling) return // 前の1回がまだ終わっていない
  const assignment = getAssignment()
  if (!assignment) return
  polling = true
  try {
    await pollInner(jobId, token, assignment)
  } finally {
    polling = false
  }
}

async function pollInner(
  jobId: string,
  token: number,
  assignment: NonNullable<ReturnType<typeof getAssignment>>,
): Promise<void> {
  let status: JobStatus
  try {
    status = await fetchJob(assignment.apiUrl, jobId)
  } catch (e) {
    if (token !== pollGeneration) return // もう別のジョブに移っている
    if (e instanceof ApiError && e.status === 404) {
      stopPolling()
      clearRememberedJob()
      generationStore.set((s) => ({
        ...s,
        phase: 'failed',
        error: 'つくった こえが みつからないよ。',
      }))
    }
    // 一時的な通信エラーは次の周期で取り直す。
    return
  }

  if (token !== pollGeneration) return // 取得中に別のジョブへ移った

  generationStore.set((s) => ({
    ...s,
    total: status.total,
    finished: status.finished,
    queuePosition: status.queuePosition,
    phase: s.phase === 'saving' ? 'saving' : status.state === 'queued' ? 'queued' : 'running',
  }))

  // できた行から順に手元へ落とす（全部そろうのを待たない）。
  await saveFinished(assignment.apiUrl, assignment.serverId, status)

  if (token !== pollGeneration) return // ダウンロード中に別のジョブへ移った

  if (status.state === 'done' || status.state === 'failed' || status.state === 'cancelled') {
    stopPolling()
    clearRememberedJob()
    const failedLines = status.results.filter((r) => r.error && r.error !== 'cancelled').length
    generationStore.set((s) => ({
      ...s,
      phase:
        status.state === 'cancelled' ? 'cancelled' : status.state === 'failed' ? 'failed' : 'done',
      failedLines,
      error:
        status.error ?? (failedLines > 0 ? `${failedLines}つの セリフが つくれなかったよ。` : null),
    }))
  }
}

/**
 * 完成した行をダウンロードして IndexedDB に入れる。
 *
 * **これが「サーバーはステートレス」を成立させている一手**。
 * 以前は絶対URLを持ち回るだけだったので、トンネルが変わったり
 * 別の台に移ったりすると、作品が静かに壊れていた。
 */
async function saveFinished(apiUrl: string, serverId: string, status: JobStatus): Promise<void> {
  const pending = status.results.filter((r) => r.artifactId && !downloaded.has(r.index))
  if (pending.length === 0) return

  for (const result of pending) {
    const lineId = lineMap[result.index]
    if (!lineId || !result.artifactId) continue
    downloaded.add(result.index) // 先に立てて二重取得を防ぐ
    try {
      const blob = await fetchArtifact(apiUrl, result.artifactId)
      await storeAudio(lineId, blob)
      workActions.setLineAudio(lineId, {
        kind: 'stored',
        key: lineId,
        // サーバー側レンダリングに使えるかもしれないヒント。
        // 無効になっても作品は壊れない（クライアント書き出しに落ちるだけ）。
        artifactId: result.artifactId,
        serverId,
      })
    } catch (e) {
      console.error(e)
      downloaded.delete(result.index) // 次の周期でやり直す
    }
  }
}

/** 生成をやめる。走っている1行は終わるが、その先は作られない。 */
export async function cancelGeneration(): Promise<void> {
  const { jobId } = generationStore.get()
  const assignment = getAssignment()
  if (!jobId || !assignment) return
  await cancelJob(assignment.apiUrl, jobId)
}

interface RememberedJob {
  jobId: string
  lines: LineId[]
  serverId: string
}

/** 控えておいたジョブを読む。壊れていれば null（呼び出し側を止めない）。 */
function readRememberedJob(): RememberedJob | null {
  try {
    const raw = localStorage.getItem(LS_JOB)
    return raw ? (JSON.parse(raw) as RememberedJob) : null
  } catch {
    return null
  }
}

/** 中断していたジョブを引き継ぐ（リロード後・タブ復帰後）。 */
export async function resumeJobIfAny(): Promise<void> {
  const assignment = getAssignment()
  if (!assignment) return
  const saved = readRememberedJob()
  if (!saved?.jobId) return
  // 別の台のジョブは追えない（成果物もその台にある）。
  if (saved.serverId !== assignment.serverId) {
    clearRememberedJob()
    return
  }
  lineMap = saved.lines
  downloaded = new Set()
  generationStore.set({
    ...idleGeneration,
    phase: 'running',
    jobId: saved.jobId,
    total: saved.lines.length,
  })
  startPolling(saved.jobId)
}

// ---- お試し -----------------------------------------------------------------

/** 録音直後に押せるプリセット（タイプ不要）。 */
export const TRYOUT_PRESETS = [
  { say: 'こんにちは！', label: 'こんにちは！' },
  { say: 'ぼく・わたしの こえだよ', label: 'ぼく・わたしの 声(こえ)だよ' },
] as const

/**
 * お試しの声を用意する。
 * 以前は2つのプリセットを**別々のリクエスト**で投げていたので、
 * 混雑時に子ども1人が2回キューに並んでいた。いまは1ジョブにまとめる。
 */
export async function prepareTryout(): Promise<void> {
  const assignment = getAssignment()
  if (!assignment) return
  const missing = TRYOUT_PRESETS.filter((p) => !tryoutStore.get().ready[p.say])
  if (missing.length === 0) return

  tryoutStore.set((s) => ({ ...s, busy: true, error: false }))
  try {
    const voiceId = await ensureVoice()
    if (!voiceId) {
      tryoutStore.set((s) => ({ ...s, busy: false, error: true }))
      return
    }
    const job = await createJob(
      assignment.apiUrl,
      voiceId,
      missing.map((p) => p.say),
    )
    const done = await waitForJob(assignment.apiUrl, job.jobId)
    for (const result of done.results) {
      const preset = missing[result.index]
      if (!preset || !result.artifactId) continue
      const blob = await fetchArtifact(assignment.apiUrl, result.artifactId)
      await storeAudio(tryoutKey(preset.say), blob)
      tryoutStore.set((s) => ({ ...s, ready: { ...s.ready, [preset.say]: true } }))
    }
    tryoutStore.set((s) => ({ ...s, busy: false }))
  } catch (e) {
    console.error(e)
    tryoutStore.set((s) => ({ ...s, busy: false, error: true }))
  }
}

export function tryoutAudioKey(phrase: string): string {
  return tryoutKey(phrase)
}

async function waitForJob(apiUrl: string, jobId: string, timeoutMs = 180_000): Promise<JobStatus> {
  const deadline = Date.now() + timeoutMs
  let status = await fetchJob(apiUrl, jobId)
  while (
    Date.now() < deadline &&
    status.state !== 'done' &&
    status.state !== 'failed' &&
    status.state !== 'cancelled'
  ) {
    await new Promise((r) => setTimeout(r, timing.pollMs))
    status = await fetchJob(apiUrl, jobId)
  }
  return status
}

/**
 * いまの台に預けた声を返してもらう（サーバーを移るとき）。
 *
 * `resetVoiceState` と違い、**手元の録音は消さない**。移った先で
 * `ensureVoice` が IndexedDB の録音から預け直すので、子どもは録音し直さずに済む。
 *
 * 消しておく理由は2つ。移ったあとも古い台の「人数」に居座り続けるのを防ぐこと
 * （その人数を見て次の子の割り当てを決めている）。そして、使わない台に
 * 子どもの声を残さないこと。
 */
export async function releaseVoice(): Promise<void> {
  stopPolling()
  clearRememberedJob()
  const { voiceId, voiceServerId } = voiceStore.get()
  const assignment = getAssignment()
  if (voiceId && assignment && voiceServerId === assignment.serverId) {
    try {
      await forgetVoice(assignment.apiUrl, voiceId)
    } catch (e) {
      // 返せなくても移動は続ける（向こうで預け直せば作品は作れる。
      // 残った声は VOICE_TTL_SEC で消える）。
      console.error(e)
    }
  }
  voiceStore.set((s) => ({ ...s, voiceId: null, voiceServerId: null, error: null }))
  generationStore.set(idleGeneration)
}

/** 次の子に渡すときの後始末。 */
export async function resetVoiceState(): Promise<void> {
  stopPolling()
  clearRememberedJob()
  const { voiceId, voiceServerId } = voiceStore.get()
  const assignment = getAssignment()
  if (voiceId && assignment && voiceServerId === assignment.serverId) {
    void forgetVoice(assignment.apiUrl, voiceId)
  }
  voiceStore.set({
    hasRecording: false,
    voiceId: null,
    voiceServerId: null,
    enrolling: false,
    error: null,
  })
  generationStore.set(idleGeneration)
  tryoutStore.set({ ready: {}, busy: false, error: false })
}
