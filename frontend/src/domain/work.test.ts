import { describe, expect, it } from 'vitest'
import * as W from './work'

function withText(): W.Work {
  let work = W.emptyWork()
  const first = work.comas[0].lineIds[0]
  work = W.updateLineText(work, first, 'やあ')
  return work
}

describe('emptyWork', () => {
  it('4コマ、各1行の空作品を作る', () => {
    const work = W.emptyWork()
    expect(work.comas).toHaveLength(W.COMA_COUNT)
    for (const coma of work.comas) expect(coma.lineIds).toHaveLength(1)
    expect(Object.keys(work.lines)).toHaveLength(W.COMA_COUNT)
  })

  it('行IDが重複しない', () => {
    const work = W.emptyWork()
    const ids = work.comas.flatMap((c) => c.lineIds)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('addLine', () => {
  it('上限まで足せる', () => {
    let work = W.emptyWork()
    for (let i = 1; i < W.MAX_LINES_PER_COMA; i++) work = W.addLine(work, 0)
    expect(work.comas[0].lineIds).toHaveLength(W.MAX_LINES_PER_COMA)
  })

  it('上限を超えると何も変わらない（同じ参照を返す）', () => {
    let work = W.emptyWork()
    for (let i = 1; i < W.MAX_LINES_PER_COMA; i++) work = W.addLine(work, 0)
    expect(W.addLine(work, 0)).toBe(work)
  })

  it('新しい行のIDが既存と衝突しない', () => {
    let work = W.emptyWork()
    work = W.addLine(work, 0)
    const ids = Object.keys(work.lines)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('deleteLine', () => {
  it('最後の1行を消しても、空の行が1つ残る', () => {
    const work = W.emptyWork()
    const only = work.comas[0].lineIds[0]
    const next = W.deleteLine(work, 0, only)
    expect(next.comas[0].lineIds).toHaveLength(1)
    expect(next.comas[0].lineIds[0]).not.toBe(only)
    expect(next.lines[next.comas[0].lineIds[0]].text).toBe('')
  })

  it('消した行の実体も辞書から消える（迷子を残さない）', () => {
    let work = W.addLine(W.emptyWork(), 0)
    const target = work.comas[0].lineIds[1]
    work = W.deleteLine(work, 0, target)
    expect(work.lines[target]).toBeUndefined()
  })
})

describe('moveLine / moveComa', () => {
  it('端では動かない（同じ参照を返す）', () => {
    const work = W.emptyWork()
    expect(W.moveComa(work, 0, -1)).toBe(work)
    expect(W.moveComa(work, work.comas.length - 1, 1)).toBe(work)
    const only = work.comas[0].lineIds[0]
    expect(W.moveLine(work, 0, only, -1)).toBe(work)
  })

  it('順番が入れ替わる', () => {
    const work = W.emptyWork()
    const before = work.comas.map((c) => c.id)
    const moved = W.moveComa(work, 0, 1)
    expect(moved.comas.map((c) => c.id)).toEqual([before[1], before[0], before[2], before[3]])
  })
})

describe('updateLineText', () => {
  it('同じ文字なら参照を変えない（無駄な再描画を起こさない）', () => {
    const work = withText()
    const id = work.comas[0].lineIds[0]
    expect(W.updateLineText(work, id, 'やあ')).toBe(work)
  })

  it('他の行の参照は変わらない（正規化の効果）', () => {
    let work = W.addLine(W.emptyWork(), 0)
    const [a, b] = work.comas[0].lineIds
    const before = work.lines[b]
    work = W.updateLineText(work, a, 'あ')
    expect(work.lines[b]).toBe(before)
  })
})

describe('meaningfulLines', () => {
  it('文字も音声も無い行は含めない', () => {
    expect(W.meaningfulLines(W.emptyWork())).toHaveLength(0)
  })

  it('文字があれば含む', () => {
    expect(W.meaningfulLines(withText())).toHaveLength(1)
  })

  it('文字が無くても音声があれば含む（自分で録音モード）', () => {
    const work = W.emptyWork()
    const id = work.comas[0].lineIds[0]
    const next = W.setLineAudio(work, id, { kind: 'stored', key: id })
    expect(W.meaningfulLines(next)).toHaveLength(1)
  })

  it('コマ順 → セリフ順に並ぶ', () => {
    let work = W.emptyWork()
    work.comas.forEach((c, i) => {
      work = W.updateLineText(work, c.lineIds[0], `c${i}`)
    })
    expect(W.meaningfulLines(work).map(({ line }) => line.text)).toEqual(['c0', 'c1', 'c2', 'c3'])
  })
})

describe('clearAllAudio / storedAudioKeys', () => {
  it('音声参照だけを外す', () => {
    let work = withText()
    const id = work.comas[0].lineIds[0]
    work = W.setLineAudio(work, id, { kind: 'stored', key: id })
    expect(W.storedAudioKeys(work)).toEqual([id])

    const cleared = W.clearAllAudio(work)
    expect(W.storedAudioKeys(cleared)).toEqual([])
    expect(cleared.lines[id].text).toBe('やあ') // 文字は残る
  })
})

describe('resetComas', () => {
  it('写真とセリフを空にし、タイトルは残す', () => {
    let work = withText()
    work = W.setTitle(work, 'ぼくの4コマ')
    work = W.setComaPanel(work, 0, 'panel-1')

    const reset = W.resetComas(work)
    expect(reset.title).toBe('ぼくの4コマ')
    expect(reset.comas[0].panelId).toBeNull()
    expect(W.hasAnyText(reset)).toBe(false)
  })

  it('リセット後の行IDが元と衝突しない（古い音声を拾わない）', () => {
    const work = withText()
    const before = new Set(Object.keys(work.lines))
    const reset = W.resetComas(work)
    for (const id of Object.keys(reset.lines)) expect(before.has(id)).toBe(false)
  })
})
