// どのサーバーを使うかを決める。
//
// ■ 負荷分散をやめた
//   10人・3台（Colab Pro+）では GPU が余る。1台に全員乗っても捌ける。
//   だから「他の端末が何をしているか」を知る必要がない。
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

import { fetchHealth } from '../infrastructure/apiClient'
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
  for (const s of order) {
    const health = await fetchHealth(s.apiUrl)
    if (!health || health.status !== 'ok') continue
    const assignment = toAssignment(s, health.canRender)
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

/** 接続先を忘れる（admin 用）。 */
export function forgetAssignment(): void {
  clearAssignment()
  connectionStore.set({ status: 'idle', assignment: null, error: null })
}
