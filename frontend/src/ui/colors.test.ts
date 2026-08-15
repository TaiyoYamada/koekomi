import { describe, expect, it } from 'vitest'
import { COLOR_LIST, colorDef, colorRuby, SERVER_COLORS } from './colors'

describe('colorDef', () => {
  it('キーから色を引ける', () => {
    expect(colorDef('red').jp).toBe('赤')
  })

  it('知らない色でも落ちない（サーバー名簿の値をそのまま受けるため）', () => {
    expect(colorDef('むらさきいろ')).toBe(SERVER_COLORS.black)
    expect(colorDef(undefined)).toBe(SERVER_COLORS.black)
    expect(colorDef('')).toBe(SERVER_COLORS.black)
  })
})

describe('colorRuby', () => {
  it('漢字の色にはふりがなを付ける', () => {
    expect(colorRuby(SERVER_COLORS.red)).toBe('赤(あか)')
    expect(colorRuby(SERVER_COLORS.cyan)).toBe('水色(みずいろ)')
  })

  it('カタカナの色はそのまま', () => {
    expect(colorRuby(SERVER_COLORS.orange)).toBe('オレンジ')
    expect(colorRuby(SERVER_COLORS.pink)).toBe('ピンク')
  })
})

describe('COLOR_LIST', () => {
  it('キーと定義の key が一致している', () => {
    for (const [key, def] of Object.entries(SERVER_COLORS)) {
      expect(def.key).toBe(key)
    }
  })

  it('色が重複していない（見分けがつかない台を作らない）', () => {
    const hexes = COLOR_LIST.map((c) => c.hex)
    expect(new Set(hexes).size).toBe(hexes.length)
  })

  it('文字色は白か濃色のどちらかで、必ず指定されている', () => {
    for (const c of COLOR_LIST) {
      expect(c.fg).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})
