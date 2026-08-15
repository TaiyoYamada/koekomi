// 劇場プレイヤー。**domain/timeline.ts が組んだ区間列をそのまま辿る**。
//
// 以前は Theater.tsx がコマとセリフを自前でループしていて、
// 書き出し側（export-video.ts）が同じ規則を別実装で持っていた。
// 片方を直すともう片方とズレる状態だったので、順序と間はここに一本化した。
// これで「プレビューで見たもの」と「書き出した動画」が必ず一致する。

import { SILENT_LINE_MS, type Segment } from '../domain/timeline'
import { speak, stopSpeaking } from '../infrastructure/speech'
import { resolveAudioUrl } from './audioUrls'
import { createStore, useStore } from './store'
import { getMode, getWork } from './workStore'

export interface PlayerState {
  playing: boolean
  /** いま映しているコマ。 */
  comaIndex: number
  /** いま喋っているセリフ（字幕を出す対象）。停止中は null。 */
  activeLineId: string | null
  /** 停止中も出しておく字幕（そのコマの最初のセリフ）。 */
  subtitle: string
}

export const playerStore = createStore<PlayerState>({
  playing: false,
  comaIndex: 0,
  activeLineId: null,
  subtitle: '',
})

export const usePlayer = () => useStore(playerStore, (s) => s)

/**
 * 再生の世代。play() のたびに増やす。
 *
 * 単純な真偽値フラグにしていたときは、**新しい再生を始めると
 * 古いループが「キャンセル解除」されて復活し、同じセリフが二重に鳴った**。
 * 各ループは自分の世代を覚えておき、世代が変わったら黙って抜ける。
 */
let generation = 0
let current: HTMLAudioElement | null = null

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 区間列を順に再生する。 */
export async function play(segments: Segment[]): Promise<void> {
  stop()
  const token = ++generation
  playerStore.set((s) => ({ ...s, playing: true }))

  for (const seg of segments) {
    if (token !== generation) return // 別の再生に取って代わられた
    playerStore.set((s) => ({
      ...s,
      comaIndex: seg.comaIndex,
      // 字幕は音が鳴り出してから出す（読み込みが間に合わなくても先行させない）。
      activeLineId: seg.lineId,
      subtitle: seg.subtitle,
    }))

    if (seg.lineId) await playLine(seg.lineId, seg.subtitle, token)
    else await wait(seg.durMs)
  }

  if (token !== generation) return
  playerStore.set((s) => ({ ...s, playing: false, activeLineId: null }))
}

/** 再生を止める。 */
export function stop(): void {
  generation++
  stopSpeaking()
  if (current) {
    current.pause()
    current = null
  }
  playerStore.set((s) =>
    s.playing || s.activeLineId ? { ...s, playing: false, activeLineId: null } : s,
  )
}

/** 表示するコマを変える（再生は止める）。
 *  停止中の字幕は画面側がタイムラインから導くので、ここでは持たない。 */
export function goToComa(comaIndex: number): void {
  stop()
  playerStore.set((s) => ({ ...s, comaIndex, subtitle: '', activeLineId: null }))
}

// ---- 内部 -------------------------------------------------------------------

async function playLine(lineId: string, text: string, token: number): Promise<void> {
  // 読み上げモードは端末の音声で喋る（録音も生成もしていない）。
  if (getMode() === 'browser-tts') {
    await speak(text)
    return
  }

  const line = getWork().lines[lineId]
  const url = line ? await resolveAudioUrl(line.audio) : null
  if (!url) {
    // 音声が無いセリフは、字幕だけ少し映して次へ。
    await wait(SILENT_LINE_MS)
    return
  }
  if (token !== generation) return

  await new Promise<void>((resolve) => {
    const audio = new Audio(url)
    current = audio
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    audio.onended = done
    // 鳴らせないときは、音声の無いセリフと同じ扱いにする。
    audio.onerror = () => setTimeout(done, 900)
    audio.play().then(undefined, (err: unknown) => {
      // 止めるボタンで pause した場合はここに来る。
      if (err instanceof DOMException && err.name === 'AbortError') done()
      else setTimeout(done, SILENT_LINE_MS)
    })
  })
}
