// AudioRef（ドメイン）→ 再生できるURL（トランスポート）の解決。
//
// ドメインは IndexedDB のキーしか持たない。<audio> に渡せる URL への
// 変換はここだけが知っている。この一枚があるおかげで、UI 層から
// `startsWith('blob:')` のような詮索が消えた。

import { useEffect } from 'react'
import type { AudioRef } from '../domain/work'
import { getAudio, putAudio, deleteAudio } from '../infrastructure/idb'
import { createStore, useStore } from './store'

/** key → object URL。読み込み済みのものだけが入る。 */
const urlStore = createStore<Record<string, string>>({})

/** 読み込み中の重複を防ぐ。 */
const inflight = new Map<string, Promise<string | null>>()

/** IndexedDB から読んで object URL にする（すでにあればそれを返す）。 */
export function ensureAudioUrl(key: string): Promise<string | null> {
  const existing = urlStore.get()[key]
  if (existing) return Promise.resolve(existing)

  const running = inflight.get(key)
  if (running) return running

  const task = (async () => {
    const blob = await getAudio(key)
    if (!blob) return null
    const url = URL.createObjectURL(blob)
    urlStore.set((prev) => (prev[key] ? prev : { ...prev, [key]: url }))
    // 競合で捨てられた方を漏らさない。
    const kept = urlStore.get()[key]
    if (kept !== url) URL.revokeObjectURL(url)
    return kept ?? url
  })().finally(() => inflight.delete(key))

  inflight.set(key, task)
  return task
}

/** 音声を保存して、すぐ再生できる状態にする。 */
export async function storeAudio(key: string, blob: Blob): Promise<void> {
  await putAudio(key, blob)
  releaseAudioUrl(key)
  const url = URL.createObjectURL(blob)
  urlStore.set((prev) => ({ ...prev, [key]: url }))
}

/** キャッシュから外す（保存データは消さない）。 */
export function releaseAudioUrl(key: string): void {
  const url = urlStore.get()[key]
  if (!url) return
  URL.revokeObjectURL(url)
  urlStore.set((prev) => {
    const next = { ...prev }
    delete next[key]
    return next
  })
}

/** 保存データごと消す。 */
export async function forgetAudio(key: string): Promise<void> {
  releaseAudioUrl(key)
  await deleteAudio(key)
}

export function releaseAll(): void {
  for (const url of Object.values(urlStore.get())) URL.revokeObjectURL(url)
  urlStore.set({})
}

/** 同期的に取れるURL（無ければ null）。再生ループのように await できない場所で使う。 */
export function peekAudioUrl(ref: AudioRef): string | null {
  if (ref.kind !== 'stored') return null
  return urlStore.get()[ref.key] ?? null
}

/** AudioRef を再生できるURLにする（無ければ読み込む）。 */
export function resolveAudioUrl(ref: AudioRef): Promise<string | null> {
  if (ref.kind !== 'stored') return Promise.resolve(null)
  return ensureAudioUrl(ref.key)
}

/** React から使う。読み込みが終わると再描画される。 */
export function useAudioUrl(ref: AudioRef | undefined): string | null {
  const key = ref?.kind === 'stored' ? ref.key : null
  const url = useStore(urlStore, (s) => (key ? (s[key] ?? null) : null))
  useEffect(() => {
    if (key && !url) void ensureAudioUrl(key)
  }, [key, url])
  return url
}

/** 劇場の再生前に、必要な音声をまとめて手元へ用意する。 */
export async function preloadAll(refs: AudioRef[]): Promise<void> {
  const keys = refs.map((r) => (r.kind === 'stored' ? r.key : null)).filter((k): k is string => !!k)
  await Promise.all(keys.map((k) => ensureAudioUrl(k)))
}
