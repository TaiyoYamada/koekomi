import { beforeEach, describe, expect, it } from 'vitest'
import {
  deserializeWork,
  loadWork,
  maxLineSeq,
  persistWork,
  serializeWork,
  type WorkSnapshot,
} from './persist'
import type { Coma } from '../types'

const line = (id: string, text: string, voiceUrl: string | null = null) => ({ id, text, voiceUrl })
const coma = (panelId: string | null, focusY: number, lines: Coma['lines']): Coma => ({
  panelId,
  focusY,
  lines,
})

const snap = (comas: Coma[]): WorkSnapshot => ({
  comas,
  started: true,
  active: 'theater',
  autoPlay: true,
  title: 'ねこの一日',
})

beforeEach(() => {
  localStorage.clear()
})

describe('serializeWork / deserializeWork', () => {
  it('テキスト・パネル・focusY・画面状態が往復で保たれる', () => {
    const comas = [
      coma('rain', 30, [line('l1', 'こんにちは'), line('l2', 'やあ')]),
      coma(null, 50, [line('l3', '')]),
    ]
    const saved = serializeWork(snap(comas), new Map())
    const { snapshot } = deserializeWork(saved)

    expect(snapshot.comas).toEqual(comas.map((c) => ({ ...c, lines: c.lines.map((l) => ({ ...l, voiceUrl: null })) })))
    expect(snapshot.started).toBe(true)
    expect(snapshot.active).toBe('theater')
    expect(snapshot.autoPlay).toBe(true)
    expect(snapshot.title).toBe('ねこの一日')
  })

  it('v1 の autoPlay:false は当時の既定なので、自動めくりオンで復元する', () => {
    // 自動めくりの既定がオフだった頃の保存データ。false は本人の意思とは限らない。
    const saved = serializeWork({ ...snap([coma('p', 50, [line('l1', 'あ')])]), autoPlay: false }, new Map())
    expect(deserializeWork({ ...saved, v: 1 }).snapshot.autoPlay).toBe(true)
  })

  it('autoPlay が無い旧データは自動めくりオンで復元する', () => {
    const saved = serializeWork(snap([coma('p', 50, [line('l1', 'あ')])]), new Map())
    delete (saved as Partial<typeof saved>).autoPlay
    expect(deserializeWork(saved as typeof saved).snapshot.autoPlay).toBe(true)
  })

  it('v2 で autoPlay を切ってあればオフのまま復元する', () => {
    const saved = serializeWork({ ...snap([coma('p', 50, [line('l1', 'あ')])]), autoPlay: false }, new Map())
    expect(saved.v).toBe(2)
    expect(deserializeWork(saved).snapshot.autoPlay).toBe(false)
  })

  it('タイトルが無い旧データは空文字で復元する', () => {
    const saved = serializeWork(snap([coma('p', 50, [line('l1', 'あ')])]), new Map())
    delete saved.title
    const { snapshot } = deserializeWork(saved)
    expect(snapshot.title).toBe('')
  })

  it('サーバーURLの音声はそのまま、idb印は null + 復元リスト行き', () => {
    const comas = [coma('p', 50, [line('l1', 'あ'), line('l2', 'い')])]
    const markers = new Map<string, string | null>([
      ['l1', 'https://api.example/files/v1.wav'],
      ['l2', 'idb'],
    ])
    const { snapshot, idbLineIds } = deserializeWork(serializeWork(snap(comas), markers))

    expect(snapshot.comas[0].lines[0].voiceUrl).toBe('https://api.example/files/v1.wav')
    expect(snapshot.comas[0].lines[1].voiceUrl).toBeNull()
    expect(idbLineIds).toEqual(['l2'])
  })

  it('壊れた focusY は 50 に丸める', () => {
    const saved = serializeWork(snap([coma('p', 999, [line('l1', 'あ')])]), new Map())
    saved.comas[0].focusY = NaN
    const { snapshot } = deserializeWork(saved)
    expect(snapshot.comas[0].focusY).toBe(50)
  })
})

describe('maxLineSeq', () => {
  it('l<番号> 形式の最大値を返す（新規IDとの衝突防止）', () => {
    const saved = serializeWork(
      snap([coma('p', 50, [line('l3', ''), line('l12', ''), line('x9', '')])]),
      new Map(),
    )
    expect(maxLineSeq(saved)).toBe(12)
  })
})

describe('loadWork / persistWork', () => {
  it('保存 → 読み込みの往復ができる（音声はサーバーURLのみ）', async () => {
    const comas = [coma('rain', 40, [line('l1', 'せりふ', 'https://api.example/files/a.wav')])]
    await persistWork(snap(comas), new Map())

    const saved = loadWork()
    expect(saved).not.toBeNull()
    const { snapshot } = deserializeWork(saved!)
    expect(snapshot.comas[0].lines[0].text).toBe('せりふ')
    expect(snapshot.comas[0].lines[0].voiceUrl).toBe('https://api.example/files/a.wav')
  })

  it('何も保存されていなければ null', () => {
    expect(loadWork()).toBeNull()
  })

  it('壊れたJSONや知らないバージョンは null（初期状態で起動）', () => {
    localStorage.setItem('vct.work.v1', '{こわれてる')
    expect(loadWork()).toBeNull()
    localStorage.setItem('vct.work.v1', JSON.stringify({ v: 99, comas: [] }))
    expect(loadWork()).toBeNull()
  })

  it('v1 の保存データも読める（授業中のリロードで作品を失わない）', () => {
    localStorage.setItem(
      'vct.work.v1',
      JSON.stringify({ v: 1, savedAt: 0, started: true, active: 'editor', autoPlay: false, comas: [] }),
    )
    expect(loadWork()?.v).toBe(1)
  })
})
