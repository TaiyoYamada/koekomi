// GAS（サーバー名簿）から「今日のURL一覧」を取る。読み取りだけ。
//
// 以前はここが presence を毎30秒 POST していた（端末20台 × 2回/分 = 40 write/分）。
// 負荷分散をやめたので、フロントから GAS への書き込みはゼロになった。

import { getGasUrl } from './config'
import type { ServerInfo } from '../domain/types'

/** GAS から現在のサーバー一覧を取得する。 */
export async function fetchServers(timeoutMs = 10_000): Promise<ServerInfo[]> {
  const gas = getGasUrl()
  if (!gas) throw new Error('サーバー名簿のURLが設定されていません')

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    // GAS にはカスタムヘッダを付けない（CORS プリフライトを避ける。GAS は OPTIONS に応答しない）。
    const res = await fetch(`${gas}?action=list`, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`サーバー一覧の取得に失敗しました (HTTP ${res.status})`)
    const data = (await res.json()) as { servers?: ServerInfo[] } | ServerInfo[]
    return Array.isArray(data) ? data : (data.servers ?? [])
  } finally {
    clearTimeout(timer)
  }
}
