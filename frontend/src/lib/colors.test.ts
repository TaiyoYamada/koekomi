import { describe, expect, it } from 'vitest'
import { COLOR_LIST, SERVER_COLORS, colorDef } from './colors'

describe('colors', () => {
  it('10色すべて定義されている', () => {
    expect(COLOR_LIST).toHaveLength(10)
    expect(Object.keys(SERVER_COLORS)).toEqual([
      'red', 'blue', 'green', 'yellow', 'purple',
      'orange', 'pink', 'cyan', 'brown', 'black',
    ])
  })

  it('既知の色は日本語名を返す', () => {
    expect(colorDef('red').jp).toBe('赤')
    expect(colorDef('cyan').jp).toBe('水色')
  })

  it('不明な色は黒にフォールバックする', () => {
    expect(colorDef('unknown').key).toBe('black')
    expect(colorDef(undefined).key).toBe('black')
  })

  it('各色は背景色と文字色を持つ', () => {
    for (const c of COLOR_LIST) {
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/i)
      expect(c.fg).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})
