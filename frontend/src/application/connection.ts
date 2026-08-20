// どのサーバーを使うかを決める。
//
// ■ 負荷分散（＝調整）をやめた
//   台数そのものは効く。1台のGPUは同時に1行しか作らないので、一斉に押されると
//   「その台に来た総行数 × 1行の秒数」がそのまま待ち時間になるからだ。
//   だが**どの台が空いているかを知る必要はない**。端末IDのハッシュで散らせば、
//   通信ゼロで概ね均等に散る（connection.test.ts で検証している）。
//   知る必要がなければ共有状態も要らず、GAS の presence も activeCount も
//   capacity も消える。**調整（coordination）こそが高くつく部分**だった。
//
// ■ 以前の壊れ方
//   全端末が同じ一覧を取り、activeCount が全部 0 で、ソートが完全に決定的
//   だったので、授業開始の合図で**全員が同じ1台目を掴んでいた**。
//   さらに presence の書き込みが詰まると全台の負荷が 0 に見え、
//   失敗すればするほど集中が強まる（フェイルセーフの向きが逆）。
//
// ■ いま
//   分散: deviceId のハッシュで開始位置を決める（通信ゼロ・決定的・偏りなし）
//   冗長: そこから順に /health を試す（調整ゼロ）
//   これで負荷分散器は実質4行になった。

import { fetchHealth, type HealthInfo } from '../infrastructure/apiClient'
import { getServerFreshSeconds } from '../infrastructure/config'
import {
  clearAssignment,
  getDeviceId,
  loadAssignment,
  saveAssignment,
} from '../infrastructure/localSettings'
import { fetchServers } from '../infrastructure/registryClient'
import type { Assignment, ServerInfo } from '../domain/types'
import { createStore, useStore } from './store'

export interface ConnectionState {
  status: 'idle' | 'connecting' | 'connected' | 'failed'
  assignment: Assignment | null
  error: string | null
}

export const connectionStore = createStore<ConnectionState>({
  status: 'idle',
  assignment: null,
  error: null,
})

export const useConnection = () => useStore(connectionStore, (s) => s)
export const getAssignment = () => connectionStore.get().assignment

// ---- 選定ロジック（純関数。テスト対象）--------------------------------------

/** lastSeen（ISO文字列 or epoch ms）を epoch ms に正規化する。 */
export function lastSeenMs(lastSeen: string): number {
  if (!lastSeen) return 0
  const asNum = Number(lastSeen)
  if (Number.isFinite(asNum) && asNum > 0) return asNum
  const t = Date.parse(lastSeen)
  return Number.isFinite(t) ? t : 0
}

/** 文字列 → 非負の整数（分散用。暗号強度は不要）。 */
export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 生きている候補（有効かつ heartbeat が新しい）を、serverId 順で安定に並べる。 */
export function liveServers(servers: ServerInfo[], now = Date.now()): ServerInfo[] {
  const freshMs = getServerFreshSeconds() * 1000
  return servers
    .filter((s) => s.enabled && s.apiUrl)
    .filter((s) => now - lastSeenMs(s.lastSeen) <= freshMs)
    .sort((a, b) => a.serverId.localeCompare(b.serverId))
}

/**
 * この端末が試す順番。
 * ハッシュで開始位置を散らし、そこから輪番に全台を回る。
 * 通信も共有状態もなしに、分散と全台フェイルオーバーの両方を満たす。
 */
export function tryOrder(servers: ServerInfo[], deviceId: string, exclude?: string): ServerInfo[] {
  const pool = servers.filter((s) => s.serverId !== exclude)
  if (pool.length === 0) return []
  const start = hashString(deviceId) % pool.length
  return pool.map((_, i) => pool[(start + i) % pool.length])
}

/** 割り当ての候補（名簿の1行と、その台が今どうなっているか）。 */
export interface Candidate {
  server: ServerInfo
  health: HealthInfo
}

/**
 * 空いている台を先に置く。**同数のときはハッシュ順のまま**。
 *
 * ■ なぜ「人数順に選ぶ」ではなく「ハッシュ順を保った並べ替え」なのか
 *   授業開始の合図では全端末が同時につなぐ。その瞬間、人数はどの台も 0 で
 *   横並びになる。人数だけで決めると全員が同じ台を選ぶ——ADR 0001 が
 *   記録している「activeCount が全部 0 で全員が1台目に殺到する」壊れ方
 *   そのものになる。
 *
 *   安定ソートにすると、同数のときの並びは tryOrder（＝ハッシュ）のままなので、
 *   一斉接続の挙動は従来と1ミリも変わらない。差がついたとき——遅れて来た子、
 *   フェイルオーバーで移ってきた子、先生が手で動かしたあと——だけ空いている台へ寄る。
 *
 *   人数は各サーバーが自分で数えた値を /health から直接読む。名簿（GAS）への
 *   書き込みは相変わらずゼロで、端末どうしも互いを知らない。
 *   **調整を増やさずに偏りだけ直す**、というのがここの狙い。
 */
export function preferEmptier(candidates: Candidate[]): Candidate[] {
  // sort は仕様上あんてい（ES2019+）。同数の並びが崩れないことに依存している。
  return [...candidates].sort(
    (a, b) => (a.health.voicesEnrolled ?? 0) - (b.health.voicesEnrolled ?? 0),
  )
}

// ---- 接続 -------------------------------------------------------------------

function toAssignment(s: ServerInfo, canRender: boolean): Assignment {
  return {
    serverId: s.serverId,
    color: s.color,
    label: s.label,
    apiUrl: s.apiUrl,
    assignedAt: Date.now(),
    canRender,
  }
}

/** 保存済みの接続先がまだ使えるか確かめる。 */
async function reuseSaved(): Promise<Assignment | null> {
  const saved = loadAssignment()
  if (!saved) return null
  const health = await fetchHealth(saved.apiUrl)
  // warming（モデル読み込み中）の台は掴まない。以前はここで "ok" が
  // 返っていたので、起動途中の台に当たった子だけが数分待たされていた。
  if (!health || health.status !== 'ok') return null
  const next = { ...saved, canRender: health.canRender }
  saveAssignment(next)
  return next
}

/**
 * 使えるサーバーを1台決める。
 * @param exclude 直前に失敗した台（再割り当て時に除外）
 */
export async function assignServer(exclude?: string): Promise<Assignment> {
  const servers = liveServers(await fetchServers())
  const order = tryOrder(servers, getDeviceId(), exclude)
  // 全台の /health を同時に見る。人数で比べるには全部の値が要るため。
  // 「先頭が生きていれば即決」より1呼び出しぶん遅くなるが、増えるのは
  // 台数ぶんの GET だけで、共有状態は1つも増えない。
  const healths = await Promise.all(order.map((s) => fetchHealth(s.apiUrl)))
  const usable = order
    .map((server, i) => ({ server, health: healths[i] }))
    // warming（モデル読み込み中）の台は掴まない。
    .filter((c): c is Candidate => c.health?.status === 'ok')
  const best = preferEmptier(usable)[0]
  if (best) {
    const assignment = toAssignment(best.server, best.health.canRender)
    saveAssignment(assignment)
    return assignment
  }
  // 除外した台しか残っていないなら、それも試す（1台構成でも詰まないように）。
  if (exclude) {
    const only = servers.find((s) => s.serverId === exclude)
    if (only) {
      const health = await fetchHealth(only.apiUrl)
      if (health?.status === 'ok') {
        const assignment = toAssignment(only, health.canRender)
        saveAssignment(assignment)
        return assignment
      }
    }
  }
  throw new Error('使えるサーバーが見つかりませんでした')
}

/** 起動時・再接続時に呼ぶ。保存済みを優先し、ダメなら選び直す。 */
export async function connect(options: { exclude?: string; force?: boolean } = {}): Promise<void> {
  connectionStore.set((s) => ({ ...s, status: 'connecting', error: null }))
  try {
    if (!options.force && !options.exclude) {
      const saved = await reuseSaved()
      if (saved) {
        connectionStore.set({ status: 'connected', assignment: saved, error: null })
        return
      }
    }
    const assignment = await assignServer(options.exclude)
    connectionStore.set({ status: 'connected', assignment, error: null })
  } catch (e) {
    connectionStore.set({
      status: 'failed',
      assignment: null,
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

/** 別の台へ移る（いまの台を除外して選び直す）。 */
export async function reassign(): Promise<void> {
  await connect({ exclude: getAssignment()?.serverId })
}

/**
 * 台を指名して移る（先生用設定から使う）。
 *
 * 自動選択（reassign）と違い、**指名した台が使えなければ移らない**。
 * 「赤が詰まっているから黄へ」と決めて押したのに、勝手に別の台へ行かれると
 * 先生が何をしたのか分からなくなるため。失敗しても今の接続先は保つ。
 */
export async function assignTo(serverId: string): Promise<void> {
  const previous = connectionStore.get()
  connectionStore.set((s) => ({ ...s, status: 'connecting', error: null }))
  try {
    const server = liveServers(await fetchServers()).find((s) => s.serverId === serverId)
    if (!server) throw new Error(`${serverId} は名簿にいません（heartbeat が止まっています）`)
    const health = await fetchHealth(server.apiUrl)
    if (!health || health.status !== 'ok') {
      throw new Error(`${serverId} はいま使えません（${health ? '準備中' : '応答なし'}）`)
    }
    const assignment = toAssignment(server, health.canRender)
    saveAssignment(assignment)
    connectionStore.set({ status: 'connected', assignment, error: null })
  } catch (e) {
    connectionStore.set(previous) // 移れなかっただけ。今の接続は切らない。
    throw e
  }
}

/** 接続先を忘れる（admin 用）。 */
export function forgetAssignment(): void {
  clearAssignment()
  connectionStore.set({ status: 'idle', assignment: null, error: null })
}
