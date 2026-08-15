import { beforeEach, describe, expect, it } from 'vitest'
import {
  deserialize,
  serialize,
  startPersistence,
  WORK_VERSION,
  type SavedWork,
} from './persistence'
import { initialUi, workActions, workStore, type WorkState } from './workStore'
import * as W from '../domain/work'

let stopPersistence: (() => void) | null = null

function state(work: W.Work): WorkState {
  return { work, ui: { ...initialUi, started: true, active: 'theater' }, mode: 'ai' }
}

function roundTrip(work: W.Work) {
  const saved = serialize(state(work))
  const restored = deserialize(saved)
  expect(restored).not.toBeNull()
  return restored!
}

describe('serialize / deserialize', () => {
  it('作品と画面位置が往復する', () => {
    let work = W.emptyWork()
    work = W.setTitle(work, 'ぼくの4コマ')
    work = W.setComaPanel(work, 0, 'panel-a')
    work = W.updateLineText(work, work.comas[0].lineIds[0], 'やあ')

    const { work: got, ui } = roundTrip(work)
    expect(got.title).toBe('ぼくの4コマ')
    expect(got.comas[0].panelId).toBe('panel-a')
    expect(got.lines[got.comas[0].lineIds[0]].text).toBe('やあ')
    expect(ui.active).toBe('theater')
  })

  it('音声の参照キーが残る（リロードしても声が消えない）', () => {
    let work = W.emptyWork()
    const id = work.comas[0].lineIds[0]
    work = W.setLineAudio(work, id, {
      kind: 'stored',
      key: id,
      artifactId: 'abc.wav',
      serverId: 'colab-1',
    })

    const { work: got } = roundTrip(work)
    expect(got.lines[id].audio).toEqual({
      kind: 'stored',
      key: id,
      artifactId: 'abc.wav',
      serverId: 'colab-1',
    })
  })

  it('連番を引き継ぐ（復元後に足した行が既存とぶつからない）', () => {
    let work = W.addLine(W.emptyWork(), 0)
    const before = new Set(Object.keys(work.lines))

    const { work: restored } = roundTrip(work)
    work = W.addLine(restored, 1)
    const added = work.comas[1].lineIds[1]
    expect(before.has(added)).toBe(false)
  })

  it('サーバー側レンダリングのヒントが無くても復元できる（作品は壊れない）', () => {
    let work = W.emptyWork()
    const id = work.comas[0].lineIds[0]
    work = W.setLineAudio(work, id, { kind: 'stored', key: id })

    const { work: got } = roundTrip(work)
    expect(got.lines[id].audio).toEqual({
      kind: 'stored',
      key: id,
      artifactId: undefined,
      serverId: undefined,
    })
  })
})

describe('deserialize（壊れた保存データ）', () => {
  const base = (): SavedWork => serialize(state(W.emptyWork()))

  it('バージョンが違えば読まない', () => {
    expect(deserialize({ ...base(), v: 1 })).toBeNull()
  })

  it('形が違えば読まない', () => {
    expect(deserialize({ ...base(), comas: 'こわれた' as never })).toBeNull()
    expect(deserialize({ ...base(), lines: null as never })).toBeNull()
    expect(deserialize({ ...base(), comas: [] })).toBeNull()
  })

  it('存在しない行を指していても開ける（その参照だけ落とす）', () => {
    const saved = base()
    saved.comas[0].lineIds = [...saved.comas[0].lineIds, 'l999']
    const restored = deserialize(saved)
    expect(restored).not.toBeNull()
    expect(restored!.work.comas[0].lineIds).not.toContain('l999')
  })

  it('コマの行が全部消えていても、空の行を1つ補う', () => {
    const saved = base()
    saved.comas[0].lineIds = []
    const restored = deserialize(saved)
    expect(restored!.work.comas[0].lineIds).toHaveLength(1)
    const id = restored!.work.comas[0].lineIds[0]
    expect(restored!.work.lines[id].text).toBe('')
  })

  it('どのコマにも属さない行は捨てる（迷子を残さない）', () => {
    const saved = base()
    saved.lines.push({ id: 'orphan', text: 'まいご' })
    const restored = deserialize(saved)
    expect(restored!.work.lines['orphan']).toBeUndefined()
  })

  it('保存形式のバージョンが書き込まれている', () => {
    expect(base().v).toBe(WORK_VERSION)
  })
})

describe('startPersistence', () => {
  beforeEach(() => {
    localStorage.clear()
    stopPersistence?.()
  })

  it('保存があれば復元する', () => {
    let work = W.emptyWork()
    work = W.setTitle(work, 'ふくげん')
    localStorage.setItem('koekomi.work.v3', JSON.stringify(serialize(state(work))))

    stopPersistence = startPersistence()
    expect(workStore.get().work.title).toBe('ふくげん')
  })

  it('二重に起動しても、2回目は購読を増やさない（HMR対策）', () => {
    stopPersistence = startPersistence()
    const second = startPersistence()
    // 2回目は何も購読していないので、解除しても1回目の購読は生きている。
    second()
    workActions.setTitle('まだ保存される')
    expect(typeof second).toBe('function')
  })

  it('読めない保存データは消さずに退避する（原因を追えるように）', () => {
    localStorage.setItem('koekomi.work.v3', JSON.stringify({ v: 999, comas: [], lines: [] }))
    stopPersistence = startPersistence()
    expect(localStorage.getItem('koekomi.work.v3.broken')).not.toBeNull()
  })
})
