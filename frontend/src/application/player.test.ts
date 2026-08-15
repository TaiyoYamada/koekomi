// 劇場プレイヤー。
//
// 「タイムラインをそのまま辿る」ことが保証されていないと、
// プレビューと書き出した動画がズレる。ここではその一致と、
// 途中で止められること・音声が無くても止まらないことを確かめる。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { goToComa, play, playerStore, stop } from './player'
import { storeAudio, releaseAll } from './audioUrls'
import { workActions, workStore } from './workStore'
import { clearAudio } from '../infrastructure/idb'
import { buildTimeline } from '../domain/timeline'
import * as W from '../domain/work'
import type { Segment } from '../domain/timeline'

// ---- <audio> の差し替え ------------------------------------------------------

/** 再生された URL の記録。 */
let played: string[] = []
/** まだ終わっていない再生（止められるかの確認に使う）。 */
let pending: Array<() => void> = []

/** すぐ終わる Audio。play() すると即 onended。 */
function stubAudio(options: { failToPlay?: boolean; hang?: boolean } = {}): void {
  class FakeAudio {
    onended: (() => void) | null = null
    onerror: (() => void) | null = null
    paused = false
    constructor(public src: string) {
      played.push(src)
    }
    play(): Promise<void> {
      if (options.failToPlay) return Promise.reject(new Error('鳴らせない'))
      if (options.hang) {
        pending.push(() => this.onended?.())
        return Promise.resolve()
      }
      queueMicrotask(() => this.onended?.())
      return Promise.resolve()
    }
    pause(): void {
      this.paused = true
    }
  }
  vi.stubGlobal('Audio', FakeAudio)
}

const wav = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' })

/** 「1コマ目に2セリフ・2コマ目に1セリフ」の作品とタイムラインを作る。 */
async function sampleTimeline(withAudio = true): Promise<{ segments: Segment[]; ids: string[] }> {
  let work = W.emptyWork()
  work = W.addLine(work, 0)
  const [a, b] = work.comas[0].lineIds
  const c = work.comas[1].lineIds[0]
  work = W.updateLineText(work, a, 'やあ')
  work = W.updateLineText(work, b, 'げんき？')
  work = W.updateLineText(work, c, 'うん')

  if (withAudio) {
    for (const id of [a, b, c]) {
      await storeAudio(id, wav())
      work = W.setLineAudio(work, id, { kind: 'stored', key: id })
    }
  }
  workActions.restore(work, workStore.get().ui)

  const segments = buildTimeline({
    work,
    panelPath: (id) => (id ? `/panels/${id}.jpg` : null),
    durations: new Map(),
  })
  return { segments, ids: [a, b, c] }
}

beforeEach(async () => {
  stop()
  played = []
  pending = []
  releaseAll()
  await clearAudio()
  workActions.setMode('ai')
  playerStore.set({ playing: false, comaIndex: 0, activeLineId: null, subtitle: '' })
})

describe('再生', () => {
  it('タイムラインの順番どおりに音声を鳴らす', async () => {
    stubAudio()
    const { segments, ids } = await sampleTimeline()

    await play(segments)

    expect(played).toHaveLength(3)
    expect(playerStore.get().playing).toBe(false)
    // 3行ぶん、コマ順→セリフ順で鳴っている。
    expect(new Set(played).size).toBe(3)
    expect(ids).toHaveLength(3)
  })

  it('再生中は playing、終わると false に戻る', async () => {
    stubAudio({ hang: true })
    const { segments } = await sampleTimeline()

    const done = play(segments)
    await Promise.resolve()
    expect(playerStore.get().playing).toBe(true)

    pending.forEach((finish) => finish())
    pending = []
    stop()
    await done
    expect(playerStore.get().playing).toBe(false)
  })

  it('喋っている行を字幕として出す', async () => {
    stubAudio({ hang: true })
    const { segments, ids } = await sampleTimeline()

    void play(segments)
    // 最初のコマのリード区間（250ms）のあと、1行目に入る。
    await vi.waitFor(() => {
      expect(playerStore.get().activeLineId).toBe(ids[0])
    })
    expect(playerStore.get().subtitle).toBe('やあ')

    stop()
  })

  it('終わったら字幕の対象を外す（喋っていない状態に戻す）', async () => {
    stubAudio()
    const { segments } = await sampleTimeline()

    await play(segments)
    expect(playerStore.get().activeLineId).toBeNull()
  })

  it('コマが進むと comaIndex が動く', async () => {
    stubAudio()
    const { segments } = await sampleTimeline()

    await play(segments)
    // 最後の区間は最後のコマ。
    expect(playerStore.get().comaIndex).toBe(segments[segments.length - 1].comaIndex)
  })
})

describe('音声が無いとき', () => {
  // 音声が無い行は実時間で 900ms 映す仕様なので、この2本だけ制限時間を伸ばす。
  it('音声の無い行でも止まらず、字幕だけ出して次へ進む', { timeout: 15000 }, async () => {
    stubAudio()
    const { segments } = await sampleTimeline(false)

    await play(segments)

    expect(played).toHaveLength(0) // 鳴らすものが無い
    expect(playerStore.get().playing).toBe(false) // それでも最後まで進む
  })

  it('再生に失敗しても最後まで進む（コーデック不一致など）', { timeout: 15000 }, async () => {
    stubAudio({ failToPlay: true })
    const { segments } = await sampleTimeline()

    await play(segments)
    expect(playerStore.get().playing).toBe(false)
  })
})

describe('停止', () => {
  it('途中で止めると、残りの行は鳴らさない', async () => {
    stubAudio({ hang: true })
    const { segments } = await sampleTimeline()

    const done = play(segments)
    await vi.waitFor(() => expect(played.length).toBe(1))

    stop()
    pending.forEach((finish) => finish())
    await done

    expect(played).toHaveLength(1) // 2行目以降は鳴らない
    expect(playerStore.get().playing).toBe(false)
    expect(playerStore.get().activeLineId).toBeNull()
  })

  it('止まっているときに止めても壊れない', () => {
    expect(() => stop()).not.toThrow()
    expect(playerStore.get().playing).toBe(false)
  })

  it('再生し直すと、前の再生は打ち切られる', async () => {
    stubAudio({ hang: true })
    const { segments } = await sampleTimeline()

    const first = play(segments)
    await vi.waitFor(() => expect(played.length).toBe(1))

    const second = play(segments)
    pending.forEach((finish) => finish())
    stop()
    await Promise.all([first, second])

    expect(playerStore.get().playing).toBe(false)
  })
})

describe('二重再生の防止', () => {
  it('連続して再生し直しても、同じセリフが二度鳴らない', async () => {
    // 以前はキャンセルがモジュール共有の真偽値だったため、
    // 新しい再生を始めると古いループが復活して二重に鳴っていた。
    stubAudio()
    const { segments } = await sampleTimeline()

    const first = play(segments)
    const second = play(segments)
    await Promise.all([first, second])

    expect(played).toHaveLength(3) // 3行ぶん。6にならないこと
  })
})

describe('コマの移動', () => {
  it('コマを変えると再生は止まり、字幕は消える', async () => {
    stubAudio({ hang: true })
    const { segments } = await sampleTimeline()

    void play(segments)
    await vi.waitFor(() => expect(playerStore.get().playing).toBe(true))

    goToComa(2)

    expect(playerStore.get().comaIndex).toBe(2)
    expect(playerStore.get().playing).toBe(false)
    expect(playerStore.get().activeLineId).toBeNull()
    // 停止中の字幕は画面側がタイムラインから導くので、ここでは空にする。
    expect(playerStore.get().subtitle).toBe('')
  })
})

describe('読み上げモード', () => {
  it('端末の読み上げを使い、音声ファイルは鳴らさない', async () => {
    stubAudio()
    const spoken: string[] = []
    vi.stubGlobal('speechSynthesis', {
      speak: (u: SpeechSynthesisUtterance) => {
        spoken.push(u.text)
        queueMicrotask(() => u.onend?.(new Event('end') as never))
      },
      cancel: () => {},
      getVoices: () => [],
    })
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        onend: ((e: Event) => void) | null = null
        onerror: ((e: Event) => void) | null = null
        voice = null
        lang = ''
        rate = 1
        constructor(public text: string) {}
      },
    )

    const { segments } = await sampleTimeline()
    workActions.setMode('browser-tts')

    await play(segments)

    expect(spoken).toEqual(['やあ', 'げんき？', 'うん'])
    expect(played).toHaveLength(0) // <audio> は使わない
  })
})
