import type { ServerColor } from '../types'

/** 1つのサーバー色の見た目情報。 */
export interface ColorDef {
  key: ServerColor
  /** 日本語名（子どもに見せる）。 */
  jp: string
  /** jp のふりがな（カタカナ色は空）。 */
  yomi: string
  /** 背景色。 */
  hex: string
  /** その背景の上に置く文字色（白 or 黒）。 */
  fg: string
}

/**
 * 10色のサーバー色。すべて見た目がはっきり違うように選んでいる。
 * GAS 側（gas/Code.gs の SERVER_COLORS）と必ず同じキーを保つこと。
 */
export const SERVER_COLORS: Record<ServerColor, ColorDef> = {
  red: { key: 'red', jp: '赤', yomi: 'あか', hex: '#e53935', fg: '#ffffff' },
  blue: { key: 'blue', jp: '青', yomi: 'あお', hex: '#1e88e5', fg: '#ffffff' },
  green: { key: 'green', jp: '緑', yomi: 'みどり', hex: '#43a047', fg: '#ffffff' },
  yellow: { key: 'yellow', jp: '黄', yomi: 'き', hex: '#fdd835', fg: '#3a2e00' },
  purple: { key: 'purple', jp: '紫', yomi: 'むらさき', hex: '#8e24aa', fg: '#ffffff' },
  orange: { key: 'orange', jp: 'オレンジ', yomi: '', hex: '#fb8c00', fg: '#3a1f00' },
  pink: { key: 'pink', jp: 'ピンク', yomi: '', hex: '#ec407a', fg: '#ffffff' },
  cyan: { key: 'cyan', jp: '水色', yomi: 'みずいろ', hex: '#00bcd4', fg: '#053238' },
  brown: { key: 'brown', jp: '茶色', yomi: 'ちゃいろ', hex: '#795548', fg: '#ffffff' },
  black: { key: 'black', jp: '黒', yomi: 'くろ', hex: '#263238', fg: '#ffffff' },
}

/** 「赤(あか)」のようなふりがな記法を返す（カタカナ色はそのまま）。 */
export function colorRuby(c: ColorDef): string {
  return c.yomi ? `${c.jp}(${c.yomi})` : c.jp
}

/** 全色を配列で返す（並び順は定義順）。 */
export const COLOR_LIST: ColorDef[] = Object.values(SERVER_COLORS)

/** 不明な色でも落ちないように安全に色定義を取得する。 */
export function colorDef(color: ServerColor | string | undefined): ColorDef {
  if (color && color in SERVER_COLORS) {
    return SERVER_COLORS[color as ServerColor]
  }
  // 不明な場合は黒扱い（最後の砦）。
  return SERVER_COLORS.black
}
