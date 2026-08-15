// 作品と画面の状態。ドメインの純関数を包んで、購読可能にするだけの薄い層。
//
// ここは **永続化を知らない**。保存は persistence.ts がこのストアを
// 購読して行う（依存の向きが逆になっていないこと）。

import * as W from '../domain/work'
import type { AudioRef, LineId, PanelId, Work } from '../domain/work'
import type { VoiceMode } from '../domain/types'
import { loadMode, saveMode } from '../infrastructure/localSettings'
import { createStore, useStore } from './store'

export interface UiState {
  /** タイトル画面を抜けたか。 */
  started: boolean
  /** 表示中のセクション。 */
  active: string
  /** 劇場の自動めくり。 */
  autoPlay: boolean
}

export interface WorkState {
  work: Work
  ui: UiState
  mode: VoiceMode
}

export const initialUi: UiState = { started: false, active: 'editor', autoPlay: true }

export const workStore = createStore<WorkState>({
  work: W.emptyWork(),
  ui: initialUi,
  mode: loadMode(),
})

// ---- 読み取り ---------------------------------------------------------------

export const useWork = () => useStore(workStore, (s) => s.work)
export const useComas = () => useStore(workStore, (s) => s.work.comas)
export const useTitle = () => useStore(workStore, (s) => s.work.title)
export const useMode = () => useStore(workStore, (s) => s.mode)
export const useUi = () => useStore(workStore, (s) => s.ui)

/** 1行だけを購読する。他の行を打っても再描画されない。 */
export const useLine = (id: LineId) => useStore(workStore, (s) => s.work.lines[id])

export const getWork = () => workStore.get().work
export const getMode = () => workStore.get().mode

// ---- 更新 -------------------------------------------------------------------

function updateWork(fn: (work: Work) => Work): void {
  workStore.set((s) => {
    const work = fn(s.work)
    return work === s.work ? s : { ...s, work }
  })
}

function updateUi(patch: Partial<UiState>): void {
  workStore.set((s) => ({ ...s, ui: { ...s.ui, ...patch } }))
}

export const workActions = {
  setStarted: (started: boolean) => updateUi({ started }),
  setActive: (active: string) => updateUi({ active }),
  setAutoPlay: (autoPlay: boolean) => updateUi({ autoPlay }),

  setMode: (mode: VoiceMode) => {
    saveMode(mode)
    workStore.set((s) => (s.mode === mode ? s : { ...s, mode }))
  },

  setComaPanel: (comaIndex: number, panelId: PanelId) =>
    updateWork((w) => W.setComaPanel(w, comaIndex, panelId)),
  moveComa: (comaIndex: number, dir: -1 | 1) => updateWork((w) => W.moveComa(w, comaIndex, dir)),
  addLine: (comaIndex: number) => updateWork((w) => W.addLine(w, comaIndex)),
  updateLineText: (lineId: LineId, text: string) =>
    updateWork((w) => W.updateLineText(w, lineId, text)),
  deleteLine: (comaIndex: number, lineId: LineId) =>
    updateWork((w) => W.deleteLine(w, comaIndex, lineId)),
  moveLine: (comaIndex: number, lineId: LineId, dir: -1 | 1) =>
    updateWork((w) => W.moveLine(w, comaIndex, lineId, dir)),
  setLineAudio: (lineId: LineId, audio: AudioRef) =>
    updateWork((w) => W.setLineAudio(w, lineId, audio)),
  setTitle: (title: string) => updateWork((w) => W.setTitle(w, title)),
  clearAllAudio: () => updateWork(W.clearAllAudio),
  resetComas: () => updateWork(W.resetComas),

  /** 保存から復元する（起動時に一度だけ）。 */
  restore: (work: Work, ui: UiState) => workStore.set((s) => ({ ...s, work, ui })),

  /** 次の子に渡すため、作品を空に戻す。連番は進めたまま（IDを再利用しない）。 */
  resetAll: () =>
    workStore.set((s) => ({
      ...s,
      work: W.emptyWork(s.work.seq),
      ui: { ...initialUi, autoPlay: s.ui.autoPlay },
    })),
}
