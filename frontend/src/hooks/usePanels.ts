import { useEffect, useState } from 'react'
import { loadPanels } from '../lib/panels'
import type { Panel } from '../types'

let cache: Panel[] | null = null

/** パネル manifest を読み込み、モジュール内にキャッシュする。 */
export function usePanels(): { panels: Panel[]; loading: boolean; error: string | null } {
  const [panels, setPanels] = useState<Panel[]>(cache ?? [])
  const [loading, setLoading] = useState(!cache)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (cache) return
    let alive = true
    loadPanels()
      .then((p) => {
        cache = p
        if (alive) setPanels(p)
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  return { panels, loading, error }
}

/** id からパネルを引く（見つからなければ undefined）。 */
export function findPanel(panels: Panel[], id: string | null): Panel | undefined {
  if (!id) return undefined
  return panels.find((p) => p.id === id)
}
