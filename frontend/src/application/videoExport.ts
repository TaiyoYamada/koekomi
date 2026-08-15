// 動画の書き出し。**サーバー側レンダリングを本命、クライアント録画を保険**とする。
//
//   サーバー: ffmpeg で数秒・確定的・タブを離れても平気
//   クライアント: 実時間・タブを離れると壊れる・コーデック依存
//
// どちらを使うかは /health の canRender で決まる。サーバーが 409
// （音声が見つからない＝ artifactId のヒントが古い）を返したときも
// 黙ってクライアント書き出しに落ちる。作品が完成しないよりはよい。

import type { Segment } from '../domain/timeline'
import { renderVideo, uploadVideo, ApiError, artifactUrl } from '../infrastructure/apiClient'
import {
  downloadBlob,
  isClientExportSupported,
  recordTimeline,
} from '../infrastructure/canvasRecorder'
import { resolveAudioUrl } from './audioUrls'
import { getAssignment } from './connection'
import { getWork } from './workStore'
import type { Work } from '../domain/work'

export type ExportMethod = 'server' | 'client'

export interface ExportOutcome {
  method: ExportMethod
  /** サーバーで作った場合。共有URLを組み立てられる。 */
  artifactId?: string
  expiresSec?: number
  /** クライアントで作った場合。 */
  blob?: Blob
  ext?: 'mp4' | 'webm'
}

export interface ExportRequest {
  segments: Segment[]
  /** panelPath → 表示用URL（クライアント書き出しのときだけ使う）。 */
  panelUrls: Map<string, string>
  onProgress?: (ratio: number) => void
  onMethod?: (method: ExportMethod) => void
  signal?: AbortSignal
}

/** この端末で何らかの方法で書き出せるか。 */
export function canExport(): boolean {
  return getAssignment()?.canRender === true || isClientExportSupported()
}

/** タイトルからファイル名を作る（ファイル名に使えない文字は除く）。 */
export function exportFileName(title: string, ext: string): string {
  const safe = title.trim().replace(/[\\/:*?"<>|]/g, '')
  return `${safe || 'koekomi-4koma'}.${ext}`
}

/** 劇場のタイムラインを動画にする。 */
export async function exportVideo(req: ExportRequest): Promise<ExportOutcome> {
  const assignment = getAssignment()

  if (assignment?.canRender) {
    try {
      req.onMethod?.('server')
      req.onProgress?.(0.1)
      const payload = toRenderSegments(req.segments, getWork())
      const { artifactId, expiresSec } = await renderVideo(assignment.apiUrl, payload, req.signal)
      req.onProgress?.(1)
      return { method: 'server', artifactId, expiresSec }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      // 503 = この台ではレンダリングできない / 409 = 音声のヒントが古い。
      // どちらもクライアント書き出しでやり直せる。
      if (!(e instanceof ApiError) || (e.status !== 503 && e.status !== 409)) {
        console.error(e)
      }
      if (!isClientExportSupported()) throw e
      console.warn('サーバーで動画を作れなかったので、この端末で書き出します', e)
    }
  }

  req.onMethod?.('client')
  const audioUrls = await collectAudioUrls(req.segments)
  const { blob, ext } = await recordTimeline({
    segments: req.segments,
    panelUrls: req.panelUrls,
    audioUrls,
    onProgress: req.onProgress,
    signal: req.signal,
  })
  return { method: 'client', blob, ext }
}

/** 書き出した動画を端末に保存する。 */
export async function saveOutcome(outcome: ExportOutcome, title: string): Promise<void> {
  if (outcome.method === 'client' && outcome.blob && outcome.ext) {
    downloadBlob(outcome.blob, exportFileName(title, outcome.ext))
    return
  }
  const assignment = getAssignment()
  if (!assignment || !outcome.artifactId) return
  // サーバーで作ったものは、いったん落としてから保存する
  // （<a download> は別オリジンだと効かないため）。
  const res = await fetch(artifactUrl(assignment.apiUrl, outcome.artifactId))
  if (!res.ok) throw new Error('動画を取得できませんでした。')
  downloadBlob(await res.blob(), exportFileName(title, 'mp4'))
}

/** 別端末に渡すためのダウンロードURL（QRコードにする）。 */
export async function shareUrlFor(
  outcome: ExportOutcome,
): Promise<{ url: string; expiresSec: number }> {
  const assignment = getAssignment()
  if (!assignment) throw new Error('サーバーにつながっていません。')

  if (outcome.method === 'server' && outcome.artifactId) {
    return {
      url: artifactUrl(assignment.apiUrl, outcome.artifactId),
      expiresSec: outcome.expiresSec ?? 1800,
    }
  }
  if (!outcome.blob || !outcome.ext) throw new Error('動画がありません。')
  const { artifactId, expiresSec } = await uploadVideo(assignment.apiUrl, outcome.blob, outcome.ext)
  return { url: artifactUrl(assignment.apiUrl, artifactId), expiresSec }
}

/** AirDrop（共有シート）に渡す File。サーバー製なら落としてから包む。 */
export async function fileFor(outcome: ExportOutcome, title: string): Promise<File> {
  if (outcome.method === 'client' && outcome.blob && outcome.ext) {
    return new File([outcome.blob], exportFileName(title, outcome.ext), {
      type: outcome.blob.type || `video/${outcome.ext}`,
    })
  }
  const assignment = getAssignment()
  if (!assignment || !outcome.artifactId) throw new Error('動画がありません。')
  const res = await fetch(artifactUrl(assignment.apiUrl, outcome.artifactId))
  if (!res.ok) throw new Error('動画を取得できませんでした。')
  const blob = await res.blob()
  return new File([blob], exportFileName(title, 'mp4'), { type: 'video/mp4' })
}

// ---- 内部 -------------------------------------------------------------------

/** ドメインのタイムラインを、サーバーに送る形にする。 */
function toRenderSegments(segments: Segment[], work: Work) {
  return segments.map((s) => {
    const line = s.lineId ? work.lines[s.lineId] : undefined
    const artifactId =
      line && line.audio.kind === 'stored' && line.audio.artifactId ? line.audio.artifactId : null
    return {
      startMs: s.startMs,
      durMs: s.durMs,
      panelPath: s.panelPath,
      subtitle: s.subtitle,
      artifactId,
    }
  })
}

/** クライアント書き出し用に、鳴らす音声の object URL を集める。 */
async function collectAudioUrls(segments: Segment[]): Promise<Map<string, string>> {
  const work = getWork()
  const urls = new Map<string, string>()
  for (const seg of segments) {
    if (!seg.lineId || urls.has(seg.lineId)) continue
    const line = work.lines[seg.lineId]
    if (!line) continue
    const url = await resolveAudioUrl(line.audio)
    if (url) urls.set(seg.lineId, url)
  }
  return urls
}
