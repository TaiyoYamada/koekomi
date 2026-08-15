import { describe, expect, it } from 'vitest'
import { coverRect, extensionFor, pickMimeType, throwIfAborted, wrapText } from './canvasRecorder'
import { FRAME_HEIGHT, FRAME_WIDTH } from '../domain/timeline'

/** measureText だけを持つ最小の偽 ctx（jsdom には canvas 実装が無いため）。 */
function fakeCtx(charWidth = 10): CanvasRenderingContext2D {
  return {
    measureText: (t: string) => ({ width: [...t].length * charWidth }) as TextMetrics,
  } as unknown as CanvasRenderingContext2D
}

describe('pickMimeType', () => {
  it('mp4 を優先する（iPad で扱いやすい）', () => {
    expect(pickMimeType(() => true)).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2')
  })

  it('mp4 が無ければ webm に落ちる', () => {
    expect(pickMimeType((t) => t.startsWith('video/webm'))).toBe('video/webm;codecs=vp9,opus')
  })

  it('どれも使えなければ null（呼び出し側が書き出しボタンを出さない）', () => {
    expect(pickMimeType(() => false)).toBeNull()
  })
})

describe('extensionFor', () => {
  it('MIME から拡張子を決める', () => {
    expect(extensionFor('video/mp4;codecs=avc1')).toBe('mp4')
    expect(extensionFor('video/webm;codecs=vp9,opus')).toBe('webm')
  })
})

describe('coverRect', () => {
  it('横長の写真は高さに合わせて左右がはみ出す', () => {
    const r = coverRect(1600, 800, FRAME_WIDTH, FRAME_HEIGHT)
    expect(r.dh).toBe(FRAME_HEIGHT)
    expect(r.dw).toBeGreaterThan(FRAME_WIDTH)
    expect(r.dx).toBeLessThan(0) // 中央寄せで左右が均等にはみ出す
    expect(r.dy).toBe(0)
  })

  it('縦長の写真は幅に合わせて上下がはみ出す', () => {
    const r = coverRect(800, 1600, FRAME_WIDTH, FRAME_HEIGHT)
    expect(r.dw).toBe(FRAME_WIDTH)
    expect(r.dh).toBeGreaterThan(FRAME_HEIGHT)
    expect(r.dy).toBeLessThan(0)
  })

  it('同じ比率ならぴったり収まる', () => {
    const r = coverRect(FRAME_WIDTH, FRAME_HEIGHT, FRAME_WIDTH, FRAME_HEIGHT)
    expect(r).toEqual({ dx: 0, dy: 0, dw: FRAME_WIDTH, dh: FRAME_HEIGHT })
  })

  it('-0 を 0 に均す（描画位置のブレを消す）', () => {
    const r = coverRect(100, 100, 100, 100)
    expect(Object.is(r.dx, -0)).toBe(false)
    expect(Object.is(r.dy, -0)).toBe(false)
  })
})

describe('wrapText', () => {
  const ctx = fakeCtx(10)

  it('幅に収まる文はそのまま1行', () => {
    expect(wrapText(ctx, 'やあ', 1000)).toEqual(['やあ'])
  })

  it('日本語は1文字ずつ詰めて折り返す（単語区切りが無いため）', () => {
    // 1文字10px、最大35px → 3文字で折り返す
    expect(wrapText(ctx, 'あいうえおか', 35)).toEqual(['あいう', 'えおか'])
  })

  it('3行を超えたら切り捨てる（画面を字幕で埋めない）', () => {
    expect(wrapText(ctx, 'あ'.repeat(100), 35)).toHaveLength(3)
  })

  it('空文字は空配列', () => {
    expect(wrapText(ctx, '', 100)).toEqual([])
  })

  it('1文字が幅を超えても、その1文字だけの行にする（無限ループにしない）', () => {
    expect(wrapText(ctx, 'あい', 5)).toEqual(['あ', 'い'])
  })
})

describe('throwIfAborted', () => {
  it('中止済みなら AbortError を投げる', () => {
    const ctrl = new AbortController()
    ctrl.abort()
    expect(() => throwIfAborted(ctrl.signal)).toThrowError(
      expect.objectContaining({ name: 'AbortError' }),
    )
  })

  it('中止していなければ何もしない', () => {
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow()
    expect(() => throwIfAborted(undefined)).not.toThrow()
  })
})
