// 写真（パネル）の読み込み。manifest の取得を UI から隠す。

import { loadPanels as fetchManifest } from '../infrastructure/panelManifest'
import type { Panel } from '../domain/types'
import { createStore, useStore } from './store'

interface PanelState {
  panels: Panel[]
  loading: boolean
  error: string | null
}

const panelStore = createStore<PanelState>({ panels: [], loading: false, error: null })

let started = false

/** 一度だけ読み込む（何度呼んでも取得は1回）。 */
export function ensurePanels(): void {
  if (started) return
  started = true
  panelStore.set((s) => ({ ...s, loading: true }))
  fetchManifest()
    .then((panels) => panelStore.set({ panels, loading: false, error: null }))
    .catch((e) => {
      started = false // 次の機会に取り直せるようにする
      panelStore.set({
        panels: [],
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      })
    })
}

export const usePanelState = () => useStore(panelStore, (s) => s)

export const getPanels = () => panelStore.get().panels

/** id からパネルを引く（見つからなければ undefined）。 */
export function findPanel(panels: Panel[], id: string | null): Panel | undefined {
  if (!id) return undefined
  return panels.find((p) => p.id === id)
}

/** panelId → 公開パス。タイムライン作りに渡す。 */
export function panelPathResolver(panels: Panel[]): (panelId: string | null) => string | null {
  return (panelId) => findPanel(panels, panelId)?.src ?? null
}
