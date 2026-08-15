// 生成ジョブの結合テスト。
//
// ここは**このアプリで一番壊れると困る経路**なので、純粋関数ではなく
// 「fetch を偽サーバーに差し替えて、実際に最後まで動かす」形で確かめる。
// IndexedDB は fake-indexeddb（本物と同じAPI）を使うので、
// 「音声がちゃんと手元に落ちているか」まで実物で検証できる。
//
// 特に見ているのは、レビューで直した4点が実際に効いているか:
//   1. 参照音声のアップロードは子ども1人につき1回だけ
//   2. 1行できるごとに手元へ落ちる（全部そろうのを待たない）
//   3. 部分失敗しても、できたぶんは残る
//   4. ドメインに絶対URLが入らない（サーバーが変わっても壊れない）

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelGeneration,
  generateVoices,
  generationStore,
  prepareTryout,
  resetVoiceState,
  restoreRecording,
  setReferenceRecording,
  timing,
  TRYOUT_PRESETS,
  tryoutStore,
  voiceStore,
} from './voiceJobs'
import { connectionStore } from './connection'
import { workStore, workActions } from './workStore'
import * as W from '../domain/work'
import { getAudio, REFERENCE_KEY } from '../infrastructure/idb'
import { releaseAll } from './audioUrls'
import type { Assignment } from '../domain/types'

// ---- 偽サーバー -------------------------------------------------------------

interface FakeServerOptions {
  /** この文言の行だけ失敗させる（部分失敗の再現）。 */
  failLines?: string[]
  /** /voices を 500 で返す。 */
  enrollFails?: boolean
  /** /jobs を 409（声の期限切れ）で返す。 */
  voiceExpired?: boolean
  /** ポーリング何回目で完了させるか（1 = 最初の取得で完了）。 */
  finishAfterPolls?: number
}

class FakeServer {
  enrollCalls = 0
  jobSubmissions: string[][] = []
  artifactFetches: string[] = []
  cancelCalls = 0
  pollCount = 0

  private jobs = new Map<string, { lines: string[]; cancelled: boolean }>()
  private seq = 0

  constructor(private opts: FakeServerOptions = {}) {}

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url.endsWith('/health')) {
      return this.json({ status: 'ok', canRender: false, ttsEffective: 'dummy' })
    }

    if (url.endsWith('/voices') && method === 'POST') {
      this.enrollCalls++
      if (this.opts.enrollFails) return this.json({ detail: 'だめ' }, 500)
      return this.json({ voiceId: 'voice-1', expiresSec: 3600 }, 201)
    }

    if (url.includes('/voices/') && method === 'DELETE') {
      return this.json({ removed: true })
    }

    if (url.endsWith('/jobs') && method === 'POST') {
      if (this.opts.voiceExpired) {
        return this.json({ detail: 'こえの じかんが きれたよ' }, 409)
      }
      const body = JSON.parse(String(init?.body)) as { voiceId: string; lines: string[] }
      this.jobSubmissions.push(body.lines)
      const jobId = `job-${++this.seq}`
      this.jobs.set(jobId, { lines: body.lines, cancelled: false })
      return this.json({ jobId, state: 'queued', total: body.lines.length }, 202)
    }

    if (url.includes('/cancel') && method === 'POST') {
      this.cancelCalls++
      const jobId = url.split('/jobs/')[1].split('/')[0]
      const job = this.jobs.get(jobId)
      if (job) job.cancelled = true
      return this.json({ cancelled: true })
    }

    if (url.includes('/jobs/') && method === 'GET') {
      this.pollCount++
      const jobId = url.split('/jobs/')[1]
      const job = this.jobs.get(jobId)
      if (!job) return this.json({ detail: 'ない' }, 404)
      return this.json(this.snapshot(jobId, job))
    }

    if (url.includes('/artifacts/')) {
      const id = url.split('/artifacts/')[1].split('?')[0]
      this.artifactFetches.push(id)
      // Response には Uint8Array を渡す（jsdom の Blob には stream() が無く、
      // Node の Response コンストラクタが受け付けないため）。
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { 'Content-Type': 'audio/wav' },
      })
    }

    return this.json({ detail: `想定外: ${method} ${url}` }, 404)
  }

  private snapshot(jobId: string, job: { lines: string[]; cancelled: boolean }) {
    const finishAfter = this.opts.finishAfterPolls ?? 1
    const ready = this.pollCount >= finishAfter
    if (job.cancelled) {
      return {
        jobId,
        state: 'cancelled',
        total: job.lines.length,
        finished: job.lines.length,
        queuePosition: 0,
        error: null,
        results: job.lines.map((_, index) => ({ index, artifactId: null, error: 'cancelled' })),
      }
    }
    if (!ready) {
      return {
        jobId,
        state: 'running',
        total: job.lines.length,
        finished: 0,
        queuePosition: 2, // 「あと2にんまち」
        error: null,
        results: [],
      }
    }
    return {
      jobId,
      state: 'done',
      total: job.lines.length,
      finished: job.lines.length,
      queuePosition: 0,
      error: null,
      results: job.lines.map((text, index) =>
        this.opts.failLines?.includes(text)
          ? { index, artifactId: null, error: 'この行は失敗した' }
          : { index, artifactId: `artifact-${jobId}-${index}.wav`, error: null },
      ),
    }
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// ---- 準備 -------------------------------------------------------------------

const assignment: Assignment = {
  serverId: 'colab-1',
  color: 'red',
  label: '赤サーバー',
  apiUrl: 'https://colab-1.example.com',
  assignedAt: 0,
  canRender: false,
}

function connectTo(a: Assignment = assignment) {
  connectionStore.set({ status: 'connected', assignment: a, error: null })
}

/** セリフを2つ書いた作品にする。 */
function writeLines(texts: string[]): string[] {
  let work = W.emptyWork()
  const ids: string[] = []
  texts.forEach((text, i) => {
    const lineId = work.comas[i].lineIds[0]
    work = W.updateLineText(work, lineId, text)
    ids.push(lineId)
  })
  workActions.restore(work, workStore.get().ui)
  return ids
}

const recording = () => new Blob([new Uint8Array([9, 9, 9])], { type: 'audio/webm' })

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))

/** 生成が終わる（または失敗する）まで待つ。 */
async function waitForPhase(...phases: string[]): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (phases.includes(generationStore.get().phase)) return
    await tick()
  }
  throw new Error(`phase が ${phases.join('/')} にならなかった: ${generationStore.get().phase}`)
}

/** 待ち順位が出るまで待つ。 */
async function waitForQueuePosition(expected: number): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (generationStore.get().queuePosition === expected) return
    await tick()
  }
  throw new Error(`待ち順位が ${expected} にならなかった`)
}

let server: FakeServer

function useServer(opts: FakeServerOptions = {}): FakeServer {
  server = new FakeServer(opts)
  vi.stubGlobal('fetch', server.fetch)
  return server
}

beforeEach(async () => {
  // フェイクタイマーは使わない（fake-indexeddb のコールバックが進まなくなる）。
  // 代わりにポーリング間隔を詰めて、実時間でも一瞬で終わるようにする。
  timing.pollMs = 5
  connectionStore.set({ status: 'idle', assignment: null, error: null })
  workActions.restore(W.emptyWork(), workStore.get().ui)
  await resetVoiceState()
  releaseAll()
})

afterEach(async () => {
  timing.pollMs = 1000
  vi.unstubAllGlobals()
})

// ---- 参照音声とエンロール ---------------------------------------------------

describe('参照音声', () => {
  it('録音すると IndexedDB に入り、リロード後も見つかる', async () => {
    useServer()
    await setReferenceRecording(recording())
    expect(voiceStore.get().hasRecording).toBe(true)

    // リロードを模す
    voiceStore.set((s) => ({ ...s, hasRecording: false }))
    await restoreRecording()
    expect(voiceStore.get().hasRecording).toBe(true)
    expect(await getAudio(REFERENCE_KEY)).not.toBeNull()
  })

  it('録り直すと、前の声はサーバーから消してもらう', async () => {
    const s = useServer()
    connectTo()
    await setReferenceRecording(recording())
    writeLines(['やあ'])
    await generateVoices()
    await waitForPhase('done')

    const deleted: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') deleted.push(String(input))
      return s.fetch(input, init)
    })

    await setReferenceRecording(recording())
    expect(deleted.some((u) => u.includes('/voices/voice-1'))).toBe(true)
    // 声を覚え直す必要があるので、voiceId は捨てられている。
    expect(voiceStore.get().voiceId).toBeNull()
  })
})

describe('エンロール（参照音声のアップロード）', () => {
  it('子ども1人につき1回しか送らない（お試し＋本番＋作り直しでも1回）', async () => {
    const s = useServer()
    connectTo()
    await setReferenceRecording(recording())
    writeLines(['やあ', 'またね'])

    await prepareTryout() // お試し
    await generateVoices() // 本番
    await waitForPhase('done')
    await generateVoices() // 作り直し
    await waitForPhase('done')

    expect(s.enrollCalls).toBe(1)
  })

  it('サーバーが変わったら覚え直す（フェイルオーバー）', async () => {
    const s = useServer()
    connectTo()
    await setReferenceRecording(recording())
    writeLines(['やあ'])
    await generateVoices()
    await waitForPhase('done')
    expect(s.enrollCalls).toBe(1)

    connectTo({ ...assignment, serverId: 'colab-2', apiUrl: 'https://colab-2.example.com' })
    await generateVoices()
    await waitForPhase('done')

    expect(s.enrollCalls).toBe(2)
    expect(voiceStore.get().voiceServerId).toBe('colab-2')
  })

  it('エンロールに失敗したら、分かるメッセージで止まる', async () => {
    useServer({ enrollFails: true })
    connectTo()
    await setReferenceRecording(recording())
    writeLines(['やあ'])

    await generateVoices()
    await waitForPhase('failed')
    expect(generationStore.get().error).toContain('ろくおん')
  })
})

// ---- 生成 -------------------------------------------------------------------

describe('生成', () => {
  it('できた行から順に IndexedDB へ落ち、ドメインは絶対URLを持たない', async () => {
    useServer()
    connectTo()
    await setReferenceRecording(recording())
    const ids = writeLines(['おはよう', 'またね'])

    await generateVoices()
    await waitForPhase('done')

    for (const id of ids) {
      const line = workStore.get().work.lines[id]
      expect(line.audio.kind).toBe('stored')
      // 実体が手元にある。
      expect(await getAudio(id)).not.toBeNull()
    }
    // 保存形式にも絶対URLが混ざらない（サーバーが変わっても壊れない）。
    expect(JSON.stringify(workStore.get().work)).not.toContain('http')
  })

  it('artifactId は「ヒント」として持つ（サーバー側レンダリング用）', async () => {
    useServer()
    connectTo()
    await setReferenceRecording(recording())
    const [id] = writeLines(['やあ'])

    await generateVoices()
    await waitForPhase('done')

    const audio = workStore.get().work.lines[id].audio
    expect(audio).toMatchObject({ kind: 'stored', key: id, serverId: 'colab-1' })
    expect(audio.kind === 'stored' && audio.artifactId).toMatch(/\.wav$/)
  })

  it('待ち順位を画面に出せる', async () => {
    useServer({ finishAfterPolls: 3 })
    connectTo()
    await setReferenceRecording(recording())
    writeLines(['やあ'])

    void generateVoices()
    // 最初のポーリングでは、まだ順番待ち。
    await waitForQueuePosition(2)
    expect(generationStore.get().queuePosition).toBe(2)

    await waitForPhase('done')
    expect(generationStore.get().queuePosition).toBe(0)
  })

  it('16行中1行失敗しても、残りは使える（部分失敗）', async () => {
    useServer({ failLines: ['だめ'] })
    connectTo()
    await setReferenceRecording(recording())
    const ids = writeLines(['よし', 'だめ', 'よし2'])

    await generateVoices()
    await waitForPhase('done')

    const lines = workStore.get().work.lines
    expect(lines[ids[0]].audio.kind).toBe('stored')
    expect(lines[ids[1]].audio.kind).toBe('none') // 失敗した行だけ音声なし
    expect(lines[ids[2]].audio.kind).toBe('stored')
    expect(generationStore.get().failedLines).toBe(1)
    expect(generationStore.get().error).toContain('1つ')
  })

  it('同じ行を二度ダウンロードしない', async () => {
    const s = useServer({ finishAfterPolls: 2 })
    connectTo()
    await setReferenceRecording(recording())
    writeLines(['やあ', 'またね'])

    await generateVoices()
    await waitForPhase('done')
    // 完了後もポーリングが数回走ることがあるが、取得は行数ぶんだけ。
    await tick(60)
    expect(s.artifactFetches).toHaveLength(2)
    expect(new Set(s.artifactFetches).size).toBe(2)
  })

  it('声の期限が切れていたら、録り直しを促す', async () => {
    useServer({ voiceExpired: true })
    connectTo()
    await setReferenceRecording(recording())
    writeLines(['やあ'])

    await generateVoices()
    await waitForPhase('failed')
    expect(generationStore.get().error).toContain('ろくおん')
    // 覚え直しが必要なので voiceId は捨てる。
    expect(voiceStore.get().voiceId).toBeNull()
  })

  it('セリフが無ければ何も投げない', async () => {
    const s = useServer()
    connectTo()
    await setReferenceRecording(recording())

    await generateVoices()
    expect(s.jobSubmissions).toHaveLength(0)
  })

  it('サーバーにつながっていなければ何も投げない', async () => {
    const s = useServer()
    await setReferenceRecording(recording())
    writeLines(['やあ'])

    await generateVoices()
    expect(s.jobSubmissions).toHaveLength(0)
  })
})

describe('キャンセル', () => {
  it('やめると、その先の行は作られない', async () => {
    const s = useServer({ finishAfterPolls: 5 })
    connectTo()
    await setReferenceRecording(recording())
    writeLines(['やあ', 'またね'])

    void generateVoices()
    await waitForQueuePosition(2)
    await cancelGeneration()
    await waitForPhase('cancelled')

    expect(s.cancelCalls).toBe(1)
    expect(s.artifactFetches).toHaveLength(0)
  })
})

// ---- お試し -----------------------------------------------------------------

describe('お試し音声', () => {
  it('プリセットを1つのジョブにまとめて投げる（1人が2回並ばない）', async () => {
    const s = useServer()
    connectTo()
    await setReferenceRecording(recording())

    await prepareTryout()

    expect(s.jobSubmissions).toHaveLength(1)
    expect(s.jobSubmissions[0]).toEqual(TRYOUT_PRESETS.map((p) => p.say))
    for (const preset of TRYOUT_PRESETS) {
      expect(tryoutStore.get().ready[preset.say]).toBe(true)
    }
  })

  it('用意済みなら投げ直さない', async () => {
    const s = useServer()
    connectTo()
    await setReferenceRecording(recording())

    await prepareTryout()
    await prepareTryout()
    expect(s.jobSubmissions).toHaveLength(1)
  })

  it('録り直すと、古い声のお試しは捨てる', async () => {
    useServer()
    connectTo()
    await setReferenceRecording(recording())
    await prepareTryout()
    expect(Object.keys(tryoutStore.get().ready)).toHaveLength(TRYOUT_PRESETS.length)

    await setReferenceRecording(recording())
    expect(tryoutStore.get().ready).toEqual({})
  })
})

// ---- 後始末 -----------------------------------------------------------------

describe('取り違えの防止', () => {
  it('前のジョブの結果が、次のジョブの表示を上書きしない', async () => {
    // ポーリングは投げっぱなしなので、interval を止めても進行中の1回が
    // あとから結果を書き戻すことがあった（テストがフレーキーになって発覚）。
    useServer({ finishAfterPolls: 3 })
    connectTo()
    await setReferenceRecording(recording())
    writeLines(['やあ'])

    void generateVoices()
    await waitForQueuePosition(2)

    // まだ終わっていないうちに次の子へ切り替える。
    await resetVoiceState()
    expect(generationStore.get().phase).toBe('idle')

    // 進行中だったポーリングが後から返っても、状態を汚さない。
    await tick(60)
    expect(generationStore.get().phase).toBe('idle')
    expect(generationStore.get().total).toBe(0)
  })
})

describe('次の子へ（リセット）', () => {
  it('声の状態を消し、サーバーの声も忘れさせる', async () => {
    const s = useServer()
    connectTo()
    await setReferenceRecording(recording())
    writeLines(['やあ'])
    await generateVoices()
    await waitForPhase('done')

    const deleted: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') deleted.push(String(input))
      return s.fetch(input, init)
    })

    await resetVoiceState()

    expect(deleted.some((u) => u.includes('/voices/voice-1'))).toBe(true)
    expect(voiceStore.get()).toMatchObject({ hasRecording: false, voiceId: null })
    expect(generationStore.get().phase).toBe('idle')
  })
})
