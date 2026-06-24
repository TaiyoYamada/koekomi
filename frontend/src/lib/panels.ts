// パネル画像の manifest を読み込む。

import type { Panel } from '../types'

/** public/panels/manifest.json を取得する。 */
export async function loadPanels(): Promise<Panel[]> {
  const res = await fetch('/panels/manifest.json')
  if (!res.ok) throw new Error('パネル画像の読み込みに失敗しました')
  return (await res.json()) as Panel[]
}
