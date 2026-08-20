// 運用者（先生・TA）向けのユースケース。
//
// 「全台の状態を一覧する」のは業務判断なので、画面ではなくここに置く。
// 画面は表を描くだけにする。

import { fetchHealth, type HealthInfo } from '../infrastructure/apiClient'
import { fetchServers } from '../infrastructure/registryClient'
import type { ServerInfo } from '../domain/types'
import { assignTo } from './connection'
import { releaseVoice } from './voiceJobs'

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

/**
 * 先生が台を指名して移す。
 *
 * 移る前に、いまの台に預けた声は返す（`releaseVoice`）。返さないと
 * 古い台の「人数」に残り続け、その人数を見て決めている次の子の割り当てが
 * 狂う。手元の録音は残るので、子どもは録音し直さなくてよい。
 *
 * **生成中は呼ばないこと**（走っているジョブは移動先には無い）。
 * 画面側で `isBusy()` の間はボタンを押せないようにしている。
 */
export async function moveToServer(serverId: string): Promise<void> {
  await releaseVoice()
  await assignTo(serverId)
}

/** その台が「いま子どもに割り当ててよい」状態か。 */
export function isUsable(status: ServerStatus): boolean {
  return status.health?.status === 'ok'
}

/** アプリのキャッシュを捨てる（更新が反映されないときの逃げ道）。 */
export { unregisterServiceWorker } from '../infrastructure/serviceWorker'
