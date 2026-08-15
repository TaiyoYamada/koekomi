// 運用者（先生・TA）向けのユースケース。
//
// 「全台の状態を一覧する」のは業務判断なので、画面ではなくここに置く。
// 画面は表を描くだけにする。

import { fetchHealth, type HealthInfo } from '../infrastructure/apiClient'
import { getGasUrl, setGasUrlOverride } from '../infrastructure/config'
import { fetchServers } from '../infrastructure/registryClient'
import type { ServerInfo } from '../domain/types'

export interface ServerStatus {
  server: ServerInfo
  /** 到達できなければ null。 */
  health: HealthInfo | null
}

/**
 * 名簿にある全台の状態を集める。
 * 1台ずつ待つと台数ぶん時間がかかるので、health は同時に聞く。
 */
export async function fetchFleetStatus(): Promise<ServerStatus[]> {
  const servers = await fetchServers()
  const health = await Promise.all(servers.map((s) => fetchHealth(s.apiUrl, 6000)))
  return servers.map((server, i) => ({ server, health: health[i] }))
}

/** その台が「いま子どもに割り当ててよい」状態か。 */
export function isUsable(status: ServerStatus): boolean {
  return status.health?.status === 'ok'
}

/** 名簿URLの読み書き（当日、再ビルドせず差し替えるため）。 */
export function readRegistryUrl(): string {
  return getGasUrl()
}

export function writeRegistryUrl(url: string): void {
  setGasUrlOverride(url)
}
