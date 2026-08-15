import { useEffect } from 'react'
import { ensurePanels, usePanelState } from '../application/panels'

export { findPanel, panelPathResolver } from '../application/panels'

/** 写真の一覧を購読する。取得は application 層が1回だけ行う。 */
export function usePanels(): ReturnType<typeof usePanelState> {
  const state = usePanelState()
  useEffect(() => {
    ensurePanels()
  }, [])
  return state
}
