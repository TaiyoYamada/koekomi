// 音声の長さ（ms）を測ってキャッシュする。
//
// タイムラインは「どのセリフを何ミリ秒映すか」を持つ必要がある。
// デコードせずに <audio> のメタデータだけ読めば十分速い。
//
// これが無いと、サーバー側レンダリングで字幕と声がズレる
// （クライアント再生は音声の終了を待つので気づけない）。

import { createStore, useStore } from './store'
import { ensureAudioUrl } from './audioUrls'
import type { AudioRef } from '../domain/work'

const durationStore = createStore<Record<string, number>>({})
const inflight = new Set<string>()

export const useDurations = () => useStore(durationStore, (s) => s)

/** 測った長さのスナップショット（React の外から読む）。 */
export const getDurations = (): Readonly<Record<string, number>> => durationStore.get()

function measure(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = new Audio()
    const done = (value: number | null) => {
      audio.onloadedmetadata = null
      audio.onerror = null
      resolve(value)
    }
    audio.onloadedmetadata = () => {
      const sec = audio.duration
      done(Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : null)
    }
    audio.onerror = () => done(null)
    audio.preload = 'metadata'
    audio.src = url
  })
}

/** まだ測っていない音声を測る。測れたぶんだけストアに入る。 */
export async function ensureDurations(refs: { lineId: string; audio: AudioRef }[]): Promise<void> {
  const todo = refs.filter(
    ({ lineId, audio }) =>
      audio.kind === 'stored' && durationStore.get()[lineId] === undefined && !inflight.has(lineId),
  )
  if (todo.length === 0) return

  for (const { lineId } of todo) inflight.add(lineId)
  try {
    await Promise.all(
      todo.map(async ({ lineId, audio }) => {
        const url = await ensureAudioUrl((audio as { key: string }).key)
        if (!url) return
        const ms = await measure(url)
        if (ms !== null) durationStore.set((prev) => ({ ...prev, [lineId]: ms }))
      }),
    )
  } finally {
    for (const { lineId } of todo) inflight.delete(lineId)
  }
}

/** 測った長さの Map（タイムライン作りに渡す）。 */
export function durationMap(snapshot: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(snapshot))
}

/** 全部忘れる（次の子に渡すとき）。前の子の長さが残ると動画がズレる。 */
export function clearDurations(): void {
  durationStore.set({})
  inflight.clear()
}

/** 音声を作り直したときに測り直す。 */
export function forgetDuration(lineId: string): void {
  durationStore.set((prev) => {
    if (prev[lineId] === undefined) return prev
    const next = { ...prev }
    delete next[lineId]
    return next
  })
}
