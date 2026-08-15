// 音声の長さの計測。
//
// これが無いと、サーバー側レンダリングで字幕と声がズレる
// （クライアント再生は音声の終了を待つので、ズレに気づけない）。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDurations,
  durationMap,
  ensureDurations,
  forgetDuration,
  getDurations,
} from './durations'
import { releaseAll } from './audioUrls'
import { clearAudio, putAudio } from '../infrastructure/idb'
import type { AudioRef } from '../domain/work'

const wav = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' })
const stored = (key: string): AudioRef => ({ kind: 'stored', key })

/**
 * jsdom の <audio> はメタデータを読まないので、Audio を差し替える。
 * `durations` が「loadedmetadata を待って duration を読む」ことだけを確かめる。
 */
function stubAudio(durationByUrl: (url: string) => number | null): void {
  class FakeAudio {
    onloadedmetadata: (() => void) | null = null
    onerror: (() => void) | null = null
    preload = ''
    duration = NaN
    #src = ''
    set src(value: string) {
      this.#src = value
      const seconds = durationByUrl(value)
      queueMicrotask(() => {
        if (seconds === null) {
          this.onerror?.()
          return
        }
        this.duration = seconds
        this.onloadedmetadata?.()
      })
    }
    get src(): string {
      return this.#src
    }
  }
  vi.stubGlobal('Audio', FakeAudio)
}

beforeEach(async () => {
  releaseAll()
  clearDurations()
  await clearAudio()
  vi.unstubAllGlobals()
})

describe('ensureDurations', () => {
  it('保存済みの音声の長さを測ってストアに入れる', async () => {
    await putAudio('l1', wav())
    stubAudio(() => 1.234)

    await ensureDurations([{ lineId: 'l1', audio: stored('l1') }])

    expect(getDurations()['l1']).toBe(1234)
  })

  it('ミリ秒の整数に丸める（タイムラインが整数msで動くため）', async () => {
    await putAudio('l2', wav())
    stubAudio(() => 2.50064)

    await ensureDurations([{ lineId: 'l2', audio: stored('l2') }])

    expect(getDurations()['l2']).toBe(2501)
    expect(Number.isInteger(getDurations()['l2'])).toBe(true)
  })

  it('音声なしの行は測らない', async () => {
    stubAudio(() => {
      throw new Error('呼ばれてはいけない')
    })
    await expect(
      ensureDurations([{ lineId: 'l1', audio: { kind: 'none' } }]),
    ).resolves.toBeUndefined()
  })

  it('読めない音声があっても、他の行の計測は続く', async () => {
    await putAudio('l1', wav())
    stubAudio((url) => (url ? 1 : null))

    await ensureDurations([
      { lineId: 'l1', audio: stored('l1') },
      { lineId: 'missing', audio: stored('missing') },
    ])

    expect(getDurations()['l1']).toBe(1000)
    expect(getDurations()['missing']).toBeUndefined()
  })

  it('メタデータが壊れていても例外にしない（動画は既定の長さで作る）', async () => {
    await putAudio('l1', wav())
    stubAudio(() => null) // onerror

    await ensureDurations([{ lineId: 'broken', audio: stored('l1') }])

    // 測れなかった行は記録しない → タイムラインは既定値（SILENT_LINE_MS）を使う。
    expect(getDurations()['broken']).toBeUndefined()
  })

  it('duration が Infinity（ストリーミング扱い）なら採用しない', async () => {
    await putAudio('l1', wav())
    stubAudio(() => Infinity)

    await ensureDurations([{ lineId: 'inf', audio: stored('l1') }])

    expect(getDurations()['inf']).toBeUndefined()
  })
})

describe('durationMap', () => {
  it('スナップショットを Map にする（タイムライン作りに渡す形）', () => {
    const map = durationMap({ l1: 100, l2: 200 })
    expect(map.get('l1')).toBe(100)
    expect(map.get('l2')).toBe(200)
    expect(map.get('l3')).toBeUndefined()
  })

  it('空でも Map を返す', () => {
    expect(durationMap({}).size).toBe(0)
  })
})

describe('forgetDuration', () => {
  it('作り直した行は測り直す', async () => {
    await putAudio('l1', wav())
    stubAudio(() => 1)
    await ensureDurations([{ lineId: 'l1', audio: stored('l1') }])
    expect(getDurations()['l1']).toBe(1000)

    forgetDuration('l1')
    expect(getDurations()['l1']).toBeUndefined()

    // 測っていない行を消しても壊れない。
    expect(() => forgetDuration('ない')).not.toThrow()
  })
})
