// localStorage への保存（端末ごとの接続先・モード）。

import type { Assignment, VoiceMode } from '../types'

const LS_ASSIGNMENT = 'vct.assignment'
const LS_MODE = 'vct.mode'

/** 保存済みの接続先を読み込む（無ければ null）。 */
export function loadAssignment(): Assignment | null {
  try {
    const raw = localStorage.getItem(LS_ASSIGNMENT)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Assignment
    if (!parsed.apiUrl || !parsed.serverId) return null
    return parsed
  } catch {
    return null
  }
}

/** 接続先を保存する。 */
export function saveAssignment(a: Assignment): void {
  localStorage.setItem(LS_ASSIGNMENT, JSON.stringify(a))
}

/** 接続先をリセットする（admin 用）。 */
export function clearAssignment(): void {
  localStorage.removeItem(LS_ASSIGNMENT)
}

/** 作品づくりモードを読み込む（既定は AI モード）。 */
export function loadMode(): VoiceMode {
  const raw = localStorage.getItem(LS_MODE)
  if (raw === 'ai' || raw === 'self-record' || raw === 'browser-tts') return raw
  return 'ai'
}

/** 作品づくりモードを保存する。 */
export function saveMode(mode: VoiceMode): void {
  localStorage.setItem(LS_MODE, mode)
}
