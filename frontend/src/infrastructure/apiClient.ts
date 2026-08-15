// バックエンド（Colab + Cloudflare Tunnel）との通信。
//
// すべて短いリクエストになった。以前の「210秒ブロックするPOST」は無い。
// iOS Safari は画面ロックやタブ移動で進行中の fetch を切るので、
// 3分間の同期リクエストは実質コイントスだった。

import { getEventToken } from './config'

export interface HealthInfo {
  status: 'ok' | 'warming'
  serverId: string
  color: string
  label: string
  ttsEffective: string
  canRender: boolean
  queueDepth: number
  activeJobs: number
  version?: string
  ttsFallback?: string | null
  warmupError?: string | null
}

export interface JobStatus {
  jobId: string
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  total: number
  finished: number
  /** 0 なら「いま作っているよ」。子どもに見せる待ち順位。 */
  queuePosition: number
  error: string | null
  results: { index: number; artifactId: string | null; error: string | null }[]
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function base(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, '')
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getEventToken()
  return { ...(token ? { 'X-Event-Token': token } : {}), ...extra }
}

/** ヘッダーを付けられない経路（<audio src> / QRコード）用のURL。 */
export function artifactUrl(apiUrl: string, artifactId: string): string {
  const token = getEventToken()
  const q = token ? `?t=${encodeURIComponent(token)}` : ''
  return `${base(apiUrl)}/artifacts/${encodeURIComponent(artifactId)}${q}`
}

async function request<T>(
  apiUrl: string,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 20_000, ...rest } = init
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  // 呼び出し側の signal も尊重する（中止ボタン）。
  const outer = rest.signal
  if (outer) {
    if (outer.aborted) ctrl.abort()
    else outer.addEventListener('abort', () => ctrl.abort(), { once: true })
  }
  let res: Response
  try {
    res = await fetch(`${base(apiUrl)}${path}`, {
      ...rest,
      signal: ctrl.signal,
      headers: authHeaders(rest.headers as Record<string, string> | undefined),
    })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { detail?: string }
      if (body?.detail) detail = body.detail
    } catch {
      // JSON でないエラー本文は無視する。
    }
    throw new ApiError(detail, res.status)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** /health を叩いて状態を取る。到達できなければ null。 */
export async function fetchHealth(apiUrl: string, timeoutMs = 5000): Promise<HealthInfo | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      // /health は無認証（接続できるかの確認そのものなので）。
      const res = await fetch(`${base(apiUrl)}/health`, { signal: ctrl.signal })
      if (!res.ok) return null
      return (await res.json()) as HealthInfo
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

/**
 * 参照音声を預けて voiceId をもらう（子ども1人につき1回）。
 * 以前は生成のたびに同じ録音を送り直していた（お試し2回＋本番1回で3回）。
 */
export async function enrollVoice(
  apiUrl: string,
  audio: Blob,
  referenceText: string,
): Promise<{ voiceId: string; expiresSec: number }> {
  const fd = new FormData()
  fd.append('audio', audio, guessFilename(audio))
  fd.append('reference_text', referenceText)
  return request(apiUrl, '/voices', { method: 'POST', body: fd, timeoutMs: 60_000 })
}

export async function forgetVoice(apiUrl: string, voiceId: string): Promise<void> {
  try {
    await request(apiUrl, `/voices/${encodeURIComponent(voiceId)}`, { method: 'DELETE' })
  } catch {
    // 消せなくても TTL で消える。呼び出し側を止めない。
  }
}

/** 生成ジョブを積む。すぐ返る。 */
export async function createJob(
  apiUrl: string,
  voiceId: string,
  lines: string[],
): Promise<JobStatus> {
  return request(apiUrl, '/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voiceId, lines }),
  })
}

export async function fetchJob(apiUrl: string, jobId: string): Promise<JobStatus> {
  return request(apiUrl, `/jobs/${encodeURIComponent(jobId)}`, { timeoutMs: 15_000 })
}

export async function cancelJob(apiUrl: string, jobId: string): Promise<void> {
  try {
    await request(apiUrl, `/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' })
  } catch {
    // キャンセルの失敗は致命的でない。
  }
}

/** 生成物を落としてくる（IndexedDB に入れるため）。 */
export async function fetchArtifact(
  apiUrl: string,
  artifactId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await fetch(`${base(apiUrl)}/artifacts/${encodeURIComponent(artifactId)}`, {
    headers: authHeaders(),
    signal,
  })
  if (!res.ok) throw new ApiError(`artifact ${artifactId}`, res.status)
  return await res.blob()
}

export interface RenderSegment {
  startMs: number
  durMs: number
  panelPath: string | null
  subtitle: string
  artifactId: string | null
}

/** タイムラインを送って動画を作ってもらう。 */
export async function renderVideo(
  apiUrl: string,
  segments: RenderSegment[],
  signal?: AbortSignal,
): Promise<{ artifactId: string; expiresSec: number }> {
  return request(apiUrl, '/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments }),
    timeoutMs: 300_000,
    signal,
  })
}

/** クライアントで書き出した動画を預ける（サーバーでレンダリングできないとき）。 */
export async function uploadVideo(
  apiUrl: string,
  blob: Blob,
  ext: 'mp4' | 'webm',
): Promise<{ artifactId: string; expiresSec: number }> {
  const fd = new FormData()
  fd.append('video', blob, `koekomi.${ext}`)
  return request(apiUrl, '/artifacts', { method: 'POST', body: fd, timeoutMs: 120_000 })
}

function guessFilename(blob: Blob): string {
  const type = blob.type || ''
  if (type.includes('mp4')) return 'reference.mp4'
  if (type.includes('wav')) return 'reference.wav'
  if (type.includes('ogg')) return 'reference.ogg'
  return 'reference.webm'
}
