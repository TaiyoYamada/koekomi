import { describe, expect, it } from 'vitest'
import * as T from './timeline'
import * as W from './work'

const panelPath = (id: string | null) => (id ? `/panels/${id}.jpg` : null)

/** 「1コマ目にセリフ2つ、2コマ目に1つ」の作品を作る。 */
function sample(): { work: W.Work; ids: string[] } {
  let work = W.emptyWork()
  work = W.setComaPanel(work, 0, 'a')
  work = W.addLine(work, 0)
  const [a, b] = work.comas[0].lineIds
  const c = work.comas[1].lineIds[0]
  work = W.updateLineText(work, a, 'やあ')
  work = W.updateLineText(work, b, 'げんき？')
  work = W.updateLineText(work, c, 'うん')
  return { work, ids: [a, b, c] }
}

describe('buildTimeline', () => {
  it('区間が隙間なく連続する（開始＝前の終わり）', () => {
    const { work } = sample()
    const segs = T.buildTimeline({ work, panelPath, durations: new Map() })
    let cursor = 0
    for (const s of segs) {
      expect(s.startMs).toBe(cursor)
      expect(s.durMs).toBeGreaterThan(0)
      cursor += s.durMs
    }
  })

  it('コマの頭は字幕なしのリード区間から始まる', () => {
    const { work } = sample()
    const segs = T.buildTimeline({ work, panelPath, durations: new Map() })
    expect(segs[0].subtitle).toBe('')
    expect(segs[0].durMs).toBe(T.COMA_LEAD_MS)
    expect(segs[0].lineId).toBeNull()
  })

  it('音声の長さが分かる行はその長さを使う', () => {
    const { work, ids } = sample()
    const segs = T.buildTimeline({
      work,
      panelPath,
      durations: new Map([[ids[0], 2500]]),
    })
    const voiced = segs.find((s) => s.lineId === ids[0])
    expect(voiced?.durMs).toBe(2500)
  })

  it('長さが分からない行は既定値になる', () => {
    const { work, ids } = sample()
    const segs = T.buildTimeline({ work, panelPath, durations: new Map() })
    expect(segs.find((s) => s.lineId === ids[0])?.durMs).toBe(T.SILENT_LINE_MS)
  })

  it('セリフの間も字幕を出したままにする（ちらつかせない）', () => {
    const { work, ids } = sample()
    const segs = T.buildTimeline({ work, panelPath, durations: new Map() })
    const i = segs.findIndex((s) => s.lineId === ids[0])
    expect(segs[i + 1].subtitle).toBe('やあ')
    expect(segs[i + 1].lineId).toBeNull() // 鳴らさない
    expect(segs[i + 1].durMs).toBe(T.LINE_GAP_MS)
  })

  it('自動めくりのときだけコマ間の待ちが入る', () => {
    const { work } = sample()
    const auto = T.buildTimeline({ work, panelPath, durations: new Map(), auto: true })
    const manual = T.buildTimeline({ work, panelPath, durations: new Map(), auto: false })
    expect(T.totalDurationMs(auto) - T.totalDurationMs(manual)).toBe(T.COMA_GAP_MS * 3)
  })

  it('中身の無いコマもリード区間だけは持つ（コマが飛ばない）', () => {
    const work = W.emptyWork()
    const segs = T.buildTimeline({ work, panelPath, durations: new Map() })
    expect(new Set(segs.map((s) => s.comaIndex)).size).toBe(W.COMA_COUNT)
  })

  it('写真のパスが区間に載る（サーバーのレンダリングに渡す）', () => {
    const { work } = sample()
    const segs = T.buildTimeline({ work, panelPath, durations: new Map() })
    expect(segs[0].panelPath).toBe('/panels/a.jpg')
    // 写真を選んでいないコマは null（暗転）。
    expect(segs.find((s) => s.comaIndex === 1)?.panelPath).toBeNull()
  })
})

describe('totalDurationMs', () => {
  it('余韻ぶんを足す', () => {
    const { work } = sample()
    const segs = T.buildTimeline({ work, panelPath, durations: new Map() })
    const last = segs[segs.length - 1]
    expect(T.totalDurationMs(segs)).toBe(last.startMs + last.durMs + T.TAIL_MS)
  })

  it('空なら0', () => {
    expect(T.totalDurationMs([])).toBe(0)
  })
})

describe('segmentAt', () => {
  it('時刻に対応する区間を返す', () => {
    const { work } = sample()
    const segs = T.buildTimeline({ work, panelPath, durations: new Map() })
    expect(T.segmentAt(segs, 0)).toBe(segs[0])
    expect(T.segmentAt(segs, T.COMA_LEAD_MS)).toBe(segs[1])
  })

  it('末尾を超えたら最後の区間（動画の最後で真っ白にしない）', () => {
    const { work } = sample()
    const segs = T.buildTimeline({ work, panelPath, durations: new Map() })
    expect(T.segmentAt(segs, 999_999)).toBe(segs[segs.length - 1])
  })
})

describe('segmentsOfComa', () => {
  it('そのコマだけを取り出し、先頭を0に詰める', () => {
    const { work } = sample()
    const segs = T.buildTimeline({ work, panelPath, durations: new Map() })
    const only = T.segmentsOfComa(segs, 1)
    expect(only.length).toBeGreaterThan(0)
    expect(only.every((s) => s.comaIndex === 1)).toBe(true)
    expect(only[0].startMs).toBe(0)
  })
})
