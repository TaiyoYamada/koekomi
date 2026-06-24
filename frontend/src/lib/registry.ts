// GAS（簡易サーバーレジストリ）との通信と、空きサーバーの自動割り当て。

import { getGasUrl, getServerFreshSeconds } from './config'
import { checkHealth } from './api'
import { loadAssignment, saveAssignment } from './storage'
import type { Assignment, ServerInfo } from '../types'

/** lastSeen（ISO文字列 or epoch ms）を epoch ms に正規化する。 */
function lastSeenMs(lastSeen: string): number {
  if (!lastSeen) return 0
  const asNum = Number(lastSeen)
  if (Number.isFinite(asNum) && asNum > 0) return asNum
  const t = Date.parse(lastSeen)
  return Number.isFinite(t) ? t : 0
}

/** GAS から現在のサーバー一覧を取得する。 */
export async function fetchServers(): Promise<ServerInfo[]> {
  const gas = getGasUrl()
  if (!gas) throw new Error('GAS の URL が設定されていません')
  // GAS にはカスタムヘッダを付けない（CORS プリフライトを避ける。GAS は OPTIONS に応答しない）。
  const res = await fetch(`${gas}?action=list`)
  if (!res.ok) throw new Error(`サーバー一覧の取得に失敗しました (HTTP ${res.status})`)
  const data = (await res.json()) as { servers?: ServerInfo[] } | ServerInfo[]
  const servers = Array.isArray(data) ? data : (data.servers ?? [])
  return servers
}

/** 割り当て候補になりうるサーバーだけに絞り、空きが多い順に並べる。 */
export function rankServers(servers: ServerInfo[]): ServerInfo[] {
  const freshMs = getServerFreshSeconds() * 1000
  const now = Date.now()
  return servers
    .filter((s) => s.enabled)
    .filter((s) => s.assignedCount < s.capacity)
    .filter((s) => now - lastSeenMs(s.lastSeen) <= freshMs)
    .sort((a, b) => {
      // 空き枠が多い順 → 同じなら新しい heartbeat 順。
      const slotA = a.capacity - a.assignedCount
      const slotB = b.capacity - b.assignedCount
      if (slotB !== slotA) return slotB - slotA
      return lastSeenMs(b.lastSeen) - lastSeenMs(a.lastSeen)
    })
}

/** GAS に「割り当てた」と伝えて assignedCount を増やす（失敗しても致命的ではない）。 */
async function notifyAssign(serverId: string): Promise<void> {
  const gas = getGasUrl()
  if (!gas) return
  try {
    // ヘッダ・ボディ無しの「単純リクエスト」にしてプリフライトを避ける。
    await fetch(`${gas}?action=assign&serverId=${encodeURIComponent(serverId)}`, {
      method: 'POST',
    })
  } catch {
    // ネットワーク失敗は無視（割り当て自体はローカルで成立させる）。
  }
}

function toAssignment(s: ServerInfo): Assignment {
  return {
    serverId: s.serverId,
    color: s.color,
    label: s.label,
    apiUrl: s.apiUrl,
    assignedAt: Date.now(),
  }
}

/**
 * GAS からサーバー一覧を取り直し、空いている中から /health が通る1台を割り当てる。
 * @param excludeId 直前に失敗したサーバー（再割り当て時に除外する）。
 */
export async function assignFreshServer(excludeId?: string): Promise<Assignment> {
  const servers = await fetchServers()
  const ranked = rankServers(servers).filter((s) => s.serverId !== excludeId)
  for (const s of ranked) {
    // 割り当て前に health を確認し、死んでいるサーバーを掴まない。
    if (await checkHealth(s.apiUrl)) {
      const assignment = toAssignment(s)
      saveAssignment(assignment)
      void notifyAssign(s.serverId)
      return assignment
    }
  }
  throw new Error('使えるサーバーが見つかりませんでした')
}

export type EnsureResult =
  | { status: 'ok'; assignment: Assignment }
  | { status: 'no-server'; error: string }

/**
 * 起動時に呼ぶ。
 * 1. localStorage の接続先があり /health が通れば、それを優先して使う。
 * 2. ダメなら GAS から取り直して別サーバーへ再割り当てする。
 * すべて失敗したら no-server を返す（→ フォールバックモードへ）。
 */
export async function ensureAssignment(): Promise<EnsureResult> {
  const saved = loadAssignment()
  if (saved && (await checkHealth(saved.apiUrl))) {
    return { status: 'ok', assignment: saved }
  }
  try {
    const assignment = await assignFreshServer(saved?.serverId)
    return { status: 'ok', assignment }
  } catch (e) {
    return { status: 'no-server', error: e instanceof Error ? e.message : String(e) }
  }
}
