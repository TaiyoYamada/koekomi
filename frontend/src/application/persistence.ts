// 作品の保存と復元。
//
// **ストアはこのファイルを知らない。** ここがストアを購読する側。
// 以前は状態コンテナ（state.tsx）が localStorage と IndexedDB を直接
// import していて、依存の向きが逆だった。
//
// 保存するもの:
//   localStorage … 作品のJSON（セリフ文・写真・音声への参照キー・画面位置）
//   IndexedDB   … 音声そのもの（audioUrls.ts / idb.ts が扱う）
//
// AI生成音声も IndexedDB に入る。以前は「サーバーURLのまま保存し、
// 落ちていたら作り直してもらう」方針だったが、3台のフェイルオーバーが
// あるとその方針は作品を静かに壊す（→ domain/work.ts の説明）。

import type { AudioRef, Coma, Line, Work } from '../domain/work'
import {
  clearAudio,
  deleteAudio,
  listAudioKeys,
  REFERENCE_KEY,
  TRYOUT_PREFIX,
} from '../infrastructure/idb'
import { releaseAll } from './audioUrls'
import { clearDurations } from './durations'
import { initialUi, workActions, workStore, type UiState, type WorkState } from './workStore'

const LS_WORK = 'koekomi.work.v3'
const SAVE_DEBOUNCE_MS = 300

/** 保存形式。バージョンを上げたら読み込み側で分岐する。 */
export const WORK_VERSION = 3

interface SavedLine {
  id: string
  text: string
  /** IndexedDB のキー。無ければ音声なし。 */
  audioKey?: string
  /** サーバー側レンダリング用のヒント（無くても作品は成立する）。 */
  artifactId?: string
  serverId?: string
}

interface SavedComa {
  id: string
  panelId: string | null
  lineIds: string[]
}

export interface SavedWork {
  v: number
  savedAt: number
  title: string
  seq: number
  comas: SavedComa[]
  lines: SavedLine[]
  ui: UiState
}

// ---- 変換（純関数。テスト対象）----------------------------------------------

export function serialize(state: WorkState): SavedWork {
  const { work, ui } = state
  return {
    v: WORK_VERSION,
    savedAt: Date.now(),
    title: work.title,
    seq: work.seq,
    comas: work.comas.map((c) => ({ id: c.id, panelId: c.panelId, lineIds: [...c.lineIds] })),
    lines: Object.values(work.lines).map((l) => ({
      id: l.id,
      text: l.text,
      ...(l.audio.kind === 'stored'
        ? { audioKey: l.audio.key, artifactId: l.audio.artifactId, serverId: l.audio.serverId }
        : {}),
    })),
    ui,
  }
}

export function deserialize(saved: SavedWork): { work: Work; ui: UiState } | null {
  if (!saved || saved.v !== WORK_VERSION) return null
  if (!Array.isArray(saved.comas) || !Array.isArray(saved.lines)) return null

  const lines: Record<string, Line> = {}
  for (const l of saved.lines) {
    if (!l?.id) continue
    const audio: AudioRef = l.audioKey
      ? { kind: 'stored', key: l.audioKey, artifactId: l.artifactId, serverId: l.serverId }
      : { kind: 'none' }
    lines[l.id] = { id: l.id, text: typeof l.text === 'string' ? l.text : '', audio }
  }

  const comas: Coma[] = saved.comas.map((c, i) => ({
    id: typeof c?.id === 'string' ? c.id : `c${i + 1}`,
    panelId: typeof c?.panelId === 'string' ? c.panelId : null,
    // 存在しない行を指していたら落とす（保存が壊れていても開けるように）。
    lineIds: (Array.isArray(c?.lineIds) ? c.lineIds : []).filter((id: string) => lines[id]),
  }))
  if (comas.length === 0) return null

  // どのコマにも属さない行は捨てる。
  const used = new Set(comas.flatMap((c) => c.lineIds))
  for (const id of Object.keys(lines)) if (!used.has(id)) delete lines[id]

  // 空になったコマには空の行を1つ足す（UI が「行ゼロ」を想定しない）。
  let seq = Number.isFinite(saved.seq) ? saved.seq : 0
  for (const coma of comas) {
    if (coma.lineIds.length === 0) {
      const id = `l${++seq}`
      lines[id] = { id, text: '', audio: { kind: 'none' } }
      coma.lineIds = [id]
    }
  }

  return {
    work: { comas, lines, title: typeof saved.title === 'string' ? saved.title : '', seq },
    ui: { ...initialUi, ...(saved.ui ?? {}) },
  }
}

// ---- localStorage -----------------------------------------------------------

export function loadSaved(): SavedWork | null {
  try {
    const raw = localStorage.getItem(LS_WORK)
    return raw ? (JSON.parse(raw) as SavedWork) : null
  } catch {
    return null
  }
}

function save(state: WorkState): void {
  try {
    localStorage.setItem(LS_WORK, JSON.stringify(serialize(state)))
  } catch {
    // 容量超過やプライベートモード。保存できなくても続行する。
  }
}

// ---- 起動と購読 -------------------------------------------------------------

/** 二重起動を防ぐ（開発中の HMR で main.tsx が再実行されることがある）。 */
let started = false

/**
 * 起動時に一度だけ呼ぶ。保存があれば復元し、以後の変更を保存し続ける。
 *
 * ■ 復元より先に保存を始めない
 *   ストアの初期値は「空の作品」。復元を試みる前に購読を始めてしまうと、
 *   何かの拍子に（初期化が二重に走る等）**空の状態が保存済みの作品を
 *   上書きして消す**。子どもの作品が黙って消えるのが一番まずいので、
 *   復元を終えるまで保存しない。二重起動もここで弾く。
 */
export function startPersistence(): () => void {
  if (started) return () => {}
  started = true

  const saved = loadSaved()
  if (saved) {
    const restored = deserialize(saved)
    if (restored) {
      workActions.restore(restored.work, restored.ui)
      void dropOrphanAudio(restored.work)
    } else {
      // 読めない保存データ。消さずに残し、別キーに退避しておく
      // （原因を追えるようにする。次の保存で上書きされて消えないように）。
      console.warn('保存データを読めませんでした。退避します。')
      try {
        localStorage.setItem(`${LS_WORK}.broken`, JSON.stringify(saved))
      } catch {
        // 退避できなくても続行する。
      }
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  const unsubscribe = workStore.subscribe(() => {
    if (timer) clearTimeout(timer)
    // 打鍵中に連続保存しない。
    timer = setTimeout(() => save(workStore.get()), SAVE_DEBOUNCE_MS)
  })
  return () => {
    if (timer) clearTimeout(timer)
    unsubscribe()
    started = false
  }
}

/** 作品から参照されていない音声を IndexedDB から消す（前の子のぶんを残さない）。 */
async function dropOrphanAudio(work: Work): Promise<void> {
  const used = new Set<string>([REFERENCE_KEY])
  for (const line of Object.values(work.lines)) {
    if (line.audio.kind === 'stored') used.add(line.audio.key)
  }
  for (const key of await listAudioKeys()) {
    if (!used.has(key) && !key.startsWith(TRYOUT_PREFIX)) void deleteAudio(key)
  }
}

/** 作品の保存データをすべて消す（次の子へ）。 */
export async function clearSavedWork(): Promise<void> {
  try {
    localStorage.removeItem(LS_WORK)
  } catch {
    // 消せなくても致命的ではない
  }
  releaseAll()
  clearDurations()
  await clearAudio()
}
