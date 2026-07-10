import { describe, expect, it } from 'vitest'
import {
  COMA_LEAD_MS,
  LINE_GAP_MS,
  SILENT_LINE_MS,
  TAIL_MS,
  buildTimeline,
  coverRect,
  extensionFor,
  pickMimeType,
  segmentAt,
  totalDurationMs,
} from './export-video'
import type { Coma, Line } from '../types'

const line = (id: string, text: string, voiceUrl: string | null = null): Line => ({
  id,
  text,
  voiceUrl,
})
const coma = (panelId: string | null, lines: Line[], focusY = 50): Coma => ({
  panelId,
  focusY,
  lines,
})

describe('coverRect', () => {
  it('横長の写真を 16:10 に敷くと左右がはみ出す', () => {
    // 2000x1000 (2.0) を 1280x800 (1.6) に cover → 高さ基準で拡大。
    const r = coverRect(2000, 1000, 1280, 800, 50)
    expect(r.dh).toBe(800)
    expect(r.dw).toBe(1600)
    expect(r.dx).toBe(-160) // 左右が均等にはみ出す
    expect(r.dy).toBe(0)
  })

  it('縦長の写真は focusY で上下位置が決まる', () => {
    // 800x1000 を 1280x800 に cover → 幅基準で拡大し 1280x1600 になる。
    const top = coverRect(800, 1000, 1280, 800, 0)
    const mid = coverRect(800, 1000, 1280, 800, 50)
    const bottom = coverRect(800, 1000, 1280, 800, 100)

    expect(top.dh).toBe(1600)
    expect(top.dy).toBe(0) // 0% は上端ぴったり
    expect(mid.dy).toBe(-400) // 50% は中央
    expect(bottom.dy).toBe(-800) // 100% は下端ぴったり
  })

  it('ちょうど同じ比率なら拡大しない', () => {
    const r = coverRect(1280, 800, 1280, 800, 50)
    expect(r).toEqual({ dx: 0, dy: 0, dw: 1280, dh: 800 })
  })
})

describe('buildTimeline', () => {
  it('コマの頭に無音の間を入れ、セリフごとに字幕を切り替える', () => {
    const comas = [coma('p1', [line('a', 'こんにちは')])]
    const segs = buildTimeline(comas, new Map([['a', 1000]]), 1)

    expect(segs).toEqual([
      { comaIndex: 0, subtitle: '', lineId: null, startMs: 0, durMs: COMA_LEAD_MS },
      { comaIndex: 0, subtitle: 'こんにちは', lineId: 'a', startMs: 250, durMs: 1000 },
      { comaIndex: 0, subtitle: 'こんにちは', lineId: null, startMs: 1250, durMs: LINE_GAP_MS },
    ])
  })

  it('音声が無いセリフは既定の長さになる', () => {
    const comas = [coma('p1', [line('a', 'むおん')])]
    const segs = buildTimeline(comas, new Map(), 1)
    expect(segs[1].durMs).toBe(SILENT_LINE_MS)
    expect(segs[1].lineId).toBe('a')
  })

  it('コマとコマの間に gapSec を挟み、最後のコマの後には挟まない', () => {
    const comas = [coma('p1', [line('a', 'あ')]), coma('p2', [line('b', 'い')])]
    const segs = buildTimeline(comas, new Map(), 2)

    const gaps = segs.filter((s) => s.subtitle === '' && s.durMs === 2000)
    expect(gaps).toHaveLength(1)
    expect(gaps[0].comaIndex).toBe(0)
    expect(segs[segs.length - 1].durMs).toBe(LINE_GAP_MS)
  })

  it('空のセリフ（テキストも音声も無い）は飛ばす', () => {
    const comas = [coma('p1', [line('a', '  '), line('b', 'ある')])]
    const segs = buildTimeline(comas, new Map(), 1)
    expect(segs.filter((s) => s.lineId).map((s) => s.lineId)).toEqual(['b'])
  })

  it('セリフが無いコマでも間だけは残る', () => {
    const comas = [coma(null, [])]
    const segs = buildTimeline(comas, new Map(), 1)
    expect(segs).toHaveLength(1)
    expect(segs[0].durMs).toBe(COMA_LEAD_MS)
  })

  it('gapSec が 0 なら間の区間を作らない', () => {
    const comas = [coma('p1', [line('a', 'あ')]), coma('p2', [line('b', 'い')])]
    const segs = buildTimeline(comas, new Map(), 0)
    expect(segs.every((s) => s.durMs > 0)).toBe(true)
  })

  it('区間は隙間なく連続する', () => {
    const comas = [
      coma('p1', [line('a', 'あ', 'blob:a'), line('b', 'い')]),
      coma('p2', [line('c', 'う')]),
    ]
    const segs = buildTimeline(comas, new Map([['a', 700]]), 1.5)
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].startMs).toBe(segs[i - 1].startMs + segs[i - 1].durMs)
    }
  })
})

describe('totalDurationMs', () => {
  it('最後の区間の終わりに余韻を足す', () => {
    const comas = [coma('p1', [line('a', 'あ')])]
    const segs = buildTimeline(comas, new Map([['a', 1000]]), 1)
    expect(totalDurationMs(segs)).toBe(COMA_LEAD_MS + 1000 + LINE_GAP_MS + TAIL_MS)
  })

  it('空なら 0', () => {
    expect(totalDurationMs([])).toBe(0)
  })
})

describe('segmentAt', () => {
  const comas = [coma('p1', [line('a', 'あ')])]
  const segs = buildTimeline(comas, new Map([['a', 1000]]), 1)

  it('区間の境界は次の区間に入る', () => {
    expect(segmentAt(segs, 0)?.subtitle).toBe('')
    expect(segmentAt(segs, 249)?.subtitle).toBe('')
    expect(segmentAt(segs, 250)?.subtitle).toBe('あ')
    expect(segmentAt(segs, 1249)?.lineId).toBe('a')
    expect(segmentAt(segs, 1250)?.lineId).toBe(null)
  })

  it('終わりを過ぎたら最後の区間を返す', () => {
    expect(segmentAt(segs, 999_999)).toBe(segs[segs.length - 1])
  })
})

describe('pickMimeType', () => {
  it('mp4 が使えるなら mp4 を選ぶ', () => {
    const mime = pickMimeType(() => true)
    expect(mime).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2')
    expect(extensionFor(mime!)).toBe('mp4')
  })

  it('mp4 が使えないなら webm に落ちる', () => {
    const mime = pickMimeType((t) => t.startsWith('video/webm'))
    expect(mime).toBe('video/webm;codecs=vp9,opus')
    expect(extensionFor(mime!)).toBe('webm')
  })

  it('どれも使えなければ null', () => {
    expect(pickMimeType(() => false)).toBeNull()
  })
})
