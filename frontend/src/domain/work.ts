// 作品のドメインモデル。React も fetch も知らない純粋なTypeScript。
//
// ■ 以前との一番大きな違い: ドメインから絶対URLを排除した
//
//   before: voiceUrl: 'https://xxx.trycloudflare.com/files/voice-ab12-3.wav'
//   after:  audio: { kind: 'stored', key: 'l7' }
//
//   前者はトランスポートのアドレスをドメインに埋め込んでいた。しかも
//   その文字列が localStorage に永続化されるので、
//     - トンネルが再起動してURLが変わる
//     - 別のサーバーにフェイルオーバーする
//   と、保存された作品が**静かに壊れる**（再生時に onerror を握りつぶして
//   無音で流れるので、エラーすら出ない）。3台を冗長構成で持つなら、
//   これは直さないと台数が意味を持たない。
//
//   いまは音声の実体はクライアントの IndexedDB にあり、`key` が正となる。
//   サーバーはステートレスな計算機で、いつ落ちても・入れ替わってもよい。

export type LineId = string
export type ComaId = string
export type PanelId = string

/**
 * 音声への参照。
 *
 * `artifactId` は「サーバー側レンダリングに使えるかもしれない」という
 * **ヒント**でしかない。正となる実体は常に IndexedDB の `key` の側にある。
 * フェイルオーバーやTTL切れでヒントが無効になっても作品は壊れず、
 * その場合はクライアント書き出しに落ちるだけ。
 */
export type AudioRef =
  { kind: 'none' } | { kind: 'stored'; key: string; artifactId?: string; serverId?: string }

export interface Line {
  id: LineId
  text: string
  audio: AudioRef
}

export interface Coma {
  id: ComaId
  panelId: PanelId | null
  lineIds: LineId[]
}

/**
 * 作品ぜんぶ。行を入れ子ではなく辞書で持つ（正規化）。
 * 1行を書き換えても他の行の参照が変わらないので、
 * 「1文字打つたびに全画面が再描画される」問題が構造的に消える。
 */
export interface Work {
  comas: Coma[]
  lines: Record<LineId, Line>
  title: string
  /** id の連番。作品と一緒に保存して、復元後の衝突を防ぐ。 */
  seq: number
}

/** コマ数（固定）。 */
export const COMA_COUNT = 4
/** 1コマあたりのセリフ上限。 */
export const MAX_LINES_PER_COMA = 4
/** セリフの文字数上限。 */
export const MAX_LINE_LENGTH = 60
/** 作品タイトルの文字数上限。 */
export const MAX_TITLE_LENGTH = 30

// ---- 生成 -------------------------------------------------------------------

function nextIds(work: Work, count: number): { ids: LineId[]; seq: number } {
  const ids: LineId[] = []
  let seq = work.seq
  for (let i = 0; i < count; i++) ids.push(`l${++seq}`)
  return { ids, seq }
}

/**
 * 空の作品を作る。
 *
 * `startSeq` から行IDを振る。リセット時に 0 から振り直すと、
 * **前の子の音声（IndexedDB は行IDをキーにしている）を新しい空行が
 * 拾ってしまう**。連番を必ず前に進めることでそれを防ぐ。
 */
export function emptyWork(startSeq = 0): Work {
  const lines: Record<LineId, Line> = {}
  const comas: Coma[] = []
  let seq = startSeq
  for (let i = 0; i < COMA_COUNT; i++) {
    const id = `l${++seq}`
    lines[id] = { id, text: '', audio: { kind: 'none' } }
    comas.push({ id: `c${i + 1}`, panelId: null, lineIds: [id] })
  }
  return { comas, lines, title: '', seq }
}

// ---- 参照 -------------------------------------------------------------------

export function linesOf(work: Work, coma: Coma): Line[] {
  return coma.lineIds.map((id) => work.lines[id]).filter(Boolean)
}

/** コマ順 → セリフ順に並べた全セリフ（生成・再生・書き出しで使う並び）。 */
export function flatLines(work: Work): { comaIndex: number; line: Line }[] {
  const out: { comaIndex: number; line: Line }[] = []
  work.comas.forEach((coma, comaIndex) => {
    for (const line of linesOf(work, coma)) out.push({ comaIndex, line })
  })
  return out
}

/** 中身のあるセリフ（文字か音声がある）。空欄は再生も生成もしない。 */
export function meaningfulLines(work: Work): { comaIndex: number; line: Line }[] {
  return flatLines(work).filter(({ line }) => line.text.trim() || line.audio.kind !== 'none')
}

export function hasAnyText(work: Work): boolean {
  return flatLines(work).some(({ line }) => line.text.trim().length > 0)
}

// ---- 更新（すべて純関数。新しい Work を返す）--------------------------------

export function setComaPanel(work: Work, comaIndex: number, panelId: PanelId): Work {
  return {
    ...work,
    comas: work.comas.map((c, i) => (i === comaIndex ? { ...c, panelId } : c)),
  }
}

function moveInArray<T>(arr: T[], index: number, dir: -1 | 1): T[] {
  const j = index + dir
  if (index < 0 || j < 0 || j >= arr.length) return arr
  const next = arr.slice()
  ;[next[index], next[j]] = [next[j], next[index]]
  return next
}

export function moveComa(work: Work, comaIndex: number, dir: -1 | 1): Work {
  const comas = moveInArray(work.comas, comaIndex, dir)
  return comas === work.comas ? work : { ...work, comas }
}

export function addLine(work: Work, comaIndex: number): Work {
  const coma = work.comas[comaIndex]
  if (!coma || coma.lineIds.length >= MAX_LINES_PER_COMA) return work
  const { ids, seq } = nextIds(work, 1)
  const id = ids[0]
  return {
    ...work,
    seq,
    lines: { ...work.lines, [id]: { id, text: '', audio: { kind: 'none' } } },
    comas: work.comas.map((c, i) => (i === comaIndex ? { ...c, lineIds: [...c.lineIds, id] } : c)),
  }
}

export function updateLineText(work: Work, lineId: LineId, text: string): Work {
  const line = work.lines[lineId]
  if (!line || line.text === text) return work
  return { ...work, lines: { ...work.lines, [lineId]: { ...line, text } } }
}

export function setLineAudio(work: Work, lineId: LineId, audio: AudioRef): Work {
  const line = work.lines[lineId]
  if (!line) return work
  return { ...work, lines: { ...work.lines, [lineId]: { ...line, audio } } }
}

/** セリフを消す。0個にはせず、最低1つの空セリフを残す。 */
export function deleteLine(work: Work, comaIndex: number, lineId: LineId): Work {
  const coma = work.comas[comaIndex]
  if (!coma || !coma.lineIds.includes(lineId)) return work

  const remaining = coma.lineIds.filter((id) => id !== lineId)
  const lines = { ...work.lines }
  delete lines[lineId]

  if (remaining.length > 0) {
    return {
      ...work,
      lines,
      comas: work.comas.map((c, i) => (i === comaIndex ? { ...c, lineIds: remaining } : c)),
    }
  }
  const { ids, seq } = nextIds(work, 1)
  const fresh = ids[0]
  lines[fresh] = { id: fresh, text: '', audio: { kind: 'none' } }
  return {
    ...work,
    seq,
    lines,
    comas: work.comas.map((c, i) => (i === comaIndex ? { ...c, lineIds: [fresh] } : c)),
  }
}

export function moveLine(work: Work, comaIndex: number, lineId: LineId, dir: -1 | 1): Work {
  const coma = work.comas[comaIndex]
  if (!coma) return work
  const idx = coma.lineIds.indexOf(lineId)
  if (idx < 0) return work
  const lineIds = moveInArray(coma.lineIds, idx, dir)
  if (lineIds === coma.lineIds) return work
  return { ...work, comas: work.comas.map((c, i) => (i === comaIndex ? { ...c, lineIds } : c)) }
}

export function setTitle(work: Work, title: string): Work {
  return work.title === title ? work : { ...work, title }
}

/** 写真とセリフを空に戻す（編集タブのリセット）。タイトルは残す。 */
export function resetComas(work: Work): Work {
  // 連番は引き継ぐ。同じIDを再利用すると前の音声を拾ってしまう。
  return { ...emptyWork(work.seq), title: work.title }
}

/** すべての音声参照を外す（サーバーが変わって作り直すときなど）。 */
export function clearAllAudio(work: Work): Work {
  const lines: Record<LineId, Line> = {}
  for (const [id, line] of Object.entries(work.lines)) {
    lines[id] = line.audio.kind === 'none' ? line : { ...line, audio: { kind: 'none' } }
  }
  return { ...work, lines }
}

/** 保存済み音声の IndexedDB キー一覧（掃除に使う）。 */
export function storedAudioKeys(work: Work): string[] {
  return Object.values(work.lines)
    .map((l) => (l.audio.kind === 'stored' ? l.audio.key : null))
    .filter((k): k is string => k !== null)
}
