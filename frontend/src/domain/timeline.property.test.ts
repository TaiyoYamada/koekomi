// タイムラインのプロパティテスト。
//
// 例示テスト（timeline.test.ts）は「自分が思いついた作品」しか試せない。
// ここでは **任意の作品** について不変条件が成り立つことを確かめる。
//
// ドメインが純粋（React も I/O も知らない）だからこそ、この検証が安く効く。
// 逆に言うと、ここが壊れると再生・クライアント書き出し・サーバーレンダリングの
// 3つが同時にズレるので、いちばん守る価値がある場所でもある。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import * as T from './timeline'
import * as W from './work'
import type { AudioRef, Work } from './work'

// ---- 任意の作品を作る --------------------------------------------------------

const textArb = fc.string({ maxLength: 40 })

const audioArb: fc.Arbitrary<AudioRef> = fc.oneof(
  fc.constant<AudioRef>({ kind: 'none' }),
  fc.string({ minLength: 1, maxLength: 8 }).map((key) => ({ kind: 'stored', key }) as AudioRef),
)

/** 4コマ・各コマ1〜4セリフの、あらゆる作品。 */
const workArb: fc.Arbitrary<Work> = fc
  .array(fc.array(fc.tuple(textArb, audioArb), { minLength: 1, maxLength: W.MAX_LINES_PER_COMA }), {
    minLength: W.COMA_COUNT,
    maxLength: W.COMA_COUNT,
  })
  .map((comaSpecs) => {
    let work = W.emptyWork()
    comaSpecs.forEach((lines, comaIndex) => {
      // 1行目は既にあるので、2行目以降を足す。
      for (let i = 1; i < lines.length; i++) work = W.addLine(work, comaIndex)
      work.comas[comaIndex].lineIds.forEach((lineId, i) => {
        const [text, audio] = lines[i] ?? lines[0]
        work = W.updateLineText(work, lineId, text)
        work = W.setLineAudio(work, lineId, audio)
      })
    })
    return work
  })

const durationsArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 8 }),
  fc.integer({ min: 1, max: 30_000 }),
)

const panelPath = (id: string | null) => (id ? `/panels/${id}.jpg` : null)

function build(work: Work, durations: Record<string, number>, auto = true): T.Segment[] {
  return T.buildTimeline({ work, panelPath, durations: new Map(Object.entries(durations)), auto })
}

// ---- 不変条件 ---------------------------------------------------------------

describe('buildTimeline の不変条件', () => {
  it('区間は隙間なく連続する（開始 = 前の区間の終わり）', () => {
    fc.assert(
      fc.property(workArb, durationsArb, fc.boolean(), (work, durations, auto) => {
        const segs = build(work, durations, auto)
        let cursor = 0
        for (const s of segs) {
          expect(s.startMs).toBe(cursor)
          cursor += s.durMs
        }
      }),
    )
  })

  it('長さが 0 以下の区間は作らない（動画が0フレームの区間を持たない）', () => {
    fc.assert(
      fc.property(workArb, durationsArb, (work, durations) => {
        for (const s of build(work, durations)) expect(s.durMs).toBeGreaterThan(0)
      }),
    )
  })

  it('全体の長さ = 各区間の和 + 余韻', () => {
    fc.assert(
      fc.property(workArb, durationsArb, (work, durations) => {
        const segs = build(work, durations)
        const sum = segs.reduce((acc, s) => acc + s.durMs, 0)
        expect(T.totalDurationMs(segs)).toBe(sum + T.TAIL_MS)
      }),
    )
  })

  it('0 〜 全長 のどの時刻を引いても、必ず区間が返る（動画が真っ白にならない）', () => {
    fc.assert(
      fc.property(workArb, durationsArb, fc.nat(), (work, durations, offset) => {
        const segs = build(work, durations)
        const total = T.totalDurationMs(segs)
        const at = offset % Math.max(1, total)
        expect(T.segmentAt(segs, at)).toBeDefined()
      }),
    )
  })

  it('コマは必ず全部登場する（中身が空でも飛ばさない）', () => {
    fc.assert(
      fc.property(workArb, durationsArb, (work, durations) => {
        const seen = new Set(build(work, durations).map((s) => s.comaIndex))
        expect(seen.size).toBe(work.comas.length)
      }),
    )
  })

  it('コマの順番は入れ替わらない（comaIndex は単調非減少）', () => {
    fc.assert(
      fc.property(workArb, durationsArb, (work, durations) => {
        const indexes = build(work, durations).map((s) => s.comaIndex)
        for (let i = 1; i < indexes.length; i++) {
          expect(indexes[i]).toBeGreaterThanOrEqual(indexes[i - 1])
        }
      }),
    )
  })

  it('音声を鳴らす区間は、必ずその作品に実在する行を指す', () => {
    fc.assert(
      fc.property(workArb, durationsArb, (work, durations) => {
        for (const s of build(work, durations)) {
          if (s.lineId) expect(work.lines[s.lineId]).toBeDefined()
        }
      }),
    )
  })

  it('同じ行を二度鳴らさない（二重再生しない）', () => {
    fc.assert(
      fc.property(workArb, durationsArb, (work, durations) => {
        const voiced = build(work, durations)
          .map((s) => s.lineId)
          .filter((id): id is string => id !== null)
        expect(new Set(voiced).size).toBe(voiced.length)
      }),
    )
  })

  it('長さが分かっている行は、その長さで映す', () => {
    fc.assert(
      fc.property(workArb, durationsArb, (work, durations) => {
        for (const s of build(work, durations)) {
          if (!s.lineId) continue
          const known = durations[s.lineId]
          expect(s.durMs).toBe(known ?? T.SILENT_LINE_MS)
        }
      }),
    )
  })

  it('自動めくりの方が、手動より必ず長い（コマ間の待ちが入るぶん）', () => {
    fc.assert(
      fc.property(workArb, durationsArb, (work, durations) => {
        const auto = T.totalDurationMs(build(work, durations, true))
        const manual = T.totalDurationMs(build(work, durations, false))
        expect(auto).toBe(manual + T.COMA_GAP_MS * (work.comas.length - 1))
      }),
    )
  })

  it('コマを取り出すと、先頭が 0 に詰められ、順序は保たれる', () => {
    fc.assert(
      fc.property(
        workArb,
        durationsArb,
        fc.nat({ max: W.COMA_COUNT - 1 }),
        (work, durations, ci) => {
          const only = T.segmentsOfComa(build(work, durations), ci)
          expect(only.length).toBeGreaterThan(0)
          expect(only[0].startMs).toBe(0)
          let cursor = 0
          for (const s of only) {
            expect(s.startMs).toBe(cursor)
            expect(s.comaIndex).toBe(ci)
            cursor += s.durMs
          }
        },
      ),
    )
  })
})

describe('work の操作の不変条件', () => {
  it('どう操作しても、行IDは常に一意', () => {
    fc.assert(
      fc.property(workArb, (work) => {
        const ids = work.comas.flatMap((c) => c.lineIds)
        expect(new Set(ids).size).toBe(ids.length)
      }),
    )
  })

  it('どのコマも、必ず1行以上を持つ（UI が行ゼロを想定しない）', () => {
    fc.assert(
      fc.property(workArb, fc.nat({ max: W.COMA_COUNT - 1 }), (work, ci) => {
        // 全部消しても1行は残る。
        let w = work
        for (const id of [...w.comas[ci].lineIds]) w = W.deleteLine(w, ci, id)
        expect(w.comas[ci].lineIds.length).toBeGreaterThanOrEqual(1)
      }),
    )
  })

  it('コマを上下に動かしても、行の総数は変わらない', () => {
    fc.assert(
      fc.property(workArb, fc.nat({ max: W.COMA_COUNT - 1 }), fc.boolean(), (work, ci, up) => {
        const before = Object.keys(work.lines).length
        const moved = W.moveComa(work, ci, up ? -1 : 1)
        expect(Object.keys(moved.lines).length).toBe(before)
      }),
    )
  })

  it('リセットしても、行IDは前の作品と絶対に衝突しない（古い音声を拾わない）', () => {
    fc.assert(
      fc.property(workArb, (work) => {
        const before = new Set(Object.keys(work.lines))
        const reset = W.resetComas(work)
        for (const id of Object.keys(reset.lines)) expect(before.has(id)).toBe(false)
      }),
    )
  })

  it('セリフを消しても、残った行の中身は変わらない', () => {
    fc.assert(
      fc.property(workArb, fc.nat({ max: W.COMA_COUNT - 1 }), (work, ci) => {
        const ids = work.comas[ci].lineIds
        if (ids.length < 2) return
        const survivors = ids.slice(1)
        const after = W.deleteLine(work, ci, ids[0])
        for (const id of survivors) {
          expect(after.lines[id].text).toBe(work.lines[id].text)
        }
      }),
    )
  })
})
