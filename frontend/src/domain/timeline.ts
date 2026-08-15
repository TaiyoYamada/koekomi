// 4コマ劇場のタイムライン。**再生規則の唯一の正**。
//
// 以前は同じ規則が2箇所に独立して実装されていた:
//   - Theater.tsx の play/playComa ループ（250ms待ち → 各行 → 150ms → コマ間）
//   - export-video.ts の buildTimeline（同じ定数を再定義）
// 片方を直すともう片方とズレる。サーバー側レンダリングを足すと3つ目ができる。
//
// ここに1つ置いて、次の3者が同じものを解釈する:
//   1. 劇場プレイヤー（再生）
//   2. クライアント書き出し（MediaRecorder・フォールバック）
//   3. サーバーの ffmpeg レンダリング（本番）
// これでプレビューと動画が一致することが構造で保証される。

import type { LineId, Work } from './work'
import { linesOf } from './work'

/** コマが切り替わってからセリフが始まるまでの間。 */
export const COMA_LEAD_MS = 250
/** セリフとセリフの間。 */
export const LINE_GAP_MS = 150
/** 音声のないセリフを映す時間。 */
export const SILENT_LINE_MS = 900
/** 最後のセリフのあと、余韻として足す時間。 */
export const TAIL_MS = 300
/**
 * 自動めくりのときの、コマとコマの間。
 * 子どもが迷う設定項目を減らすため固定値（画面からは変更できない）。
 */
export const COMA_GAP_MS = 500

/** 書き出しサイズ（劇場のスクリーンと同じ 16:10）。サーバー側と一致させること。 */
export const FRAME_WIDTH = 1280
export const FRAME_HEIGHT = 800

export interface Segment {
  startMs: number
  durMs: number
  comaIndex: number
  /** 背景写真の公開パス（`/panels/xxx.jpg`）。無ければ暗転。 */
  panelPath: string | null
  /** 空文字なら字幕を出さない。 */
  subtitle: string
  /** この区間の頭で鳴らす音声の行。鳴らさないなら null。 */
  lineId: LineId | null
}

export interface TimelineInput {
  work: Work
  /** panelId → 公開パス。 */
  panelPath: (panelId: string | null) => string | null
  /** 行ID → 音声の長さ(ms)。分からない行は SILENT_LINE_MS を使う。 */
  durations: Map<LineId, number>
  /** 自動めくりが有効か。オフなら 1 コマで止まるので、コマ間の待ちは入れない。 */
  auto?: boolean
}

/** 作品を時間軸に並べる。 */
export function buildTimeline({
  work,
  panelPath,
  durations,
  auto = true,
}: TimelineInput): Segment[] {
  const segs: Segment[] = []
  let t = 0

  const push = (
    comaIndex: number,
    panel: string | null,
    subtitle: string,
    lineId: LineId | null,
    durMs: number,
  ) => {
    if (durMs <= 0) return
    segs.push({ startMs: t, durMs, comaIndex, panelPath: panel, subtitle, lineId })
    t += durMs
  }

  work.comas.forEach((coma, comaIndex) => {
    const panel = panelPath(coma.panelId)
    // コマが切り替わった直後は字幕なし。
    push(comaIndex, panel, '', null, COMA_LEAD_MS)

    const lines = linesOf(work, coma).filter((l) => l.text.trim() || l.audio.kind !== 'none')
    for (const line of lines) {
      push(comaIndex, panel, line.text, line.id, durations.get(line.id) ?? SILENT_LINE_MS)
      // セリフの間は字幕を出したままにする。
      push(comaIndex, panel, line.text, null, LINE_GAP_MS)
    }

    // 次のコマまでの間。字幕は消す。
    if (auto && comaIndex < work.comas.length - 1) push(comaIndex, panel, '', null, COMA_GAP_MS)
  })

  return segs
}

/** タイムライン全体の長さ（余韻込み）。 */
export function totalDurationMs(segs: Segment[]): number {
  if (segs.length === 0) return 0
  const last = segs[segs.length - 1]
  return last.startMs + last.durMs + TAIL_MS
}

/** ある時刻に表示すべき区間。 */
export function segmentAt(segs: Segment[], ms: number): Segment | undefined {
  for (const s of segs) {
    if (ms >= s.startMs && ms < s.startMs + s.durMs) return s
  }
  return segs[segs.length - 1]
}

/** そのコマの区間だけを、先頭を 0 に詰め直して返す（手動めくりの1コマ再生用）。 */
export function segmentsOfComa(segs: Segment[], comaIndex: number): Segment[] {
  const own = segs.filter((s) => s.comaIndex === comaIndex)
  if (own.length === 0) return []
  const offset = own[0].startMs
  return own.map((s) => ({ ...s, startMs: s.startMs - offset }))
}
