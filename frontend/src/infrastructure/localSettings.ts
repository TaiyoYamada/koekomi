// localStorage に置く小さな設定（端末ID・モード・接続先）。
// 作品そのものは application/persistence.ts が扱う。

import type { Assignment, VoiceMode } from '../domain/types'

const LS_ASSIGNMENT = 'koekomi.assignment'
const LS_MODE = 'koekomi.mode'
const LS_DEVICE = 'koekomi.deviceId'

/**
 * この端末のID。
 * もともと presence（負荷分散）のために作ったものだが、
 * 負荷分散をやめた今は「ハッシュで開始サーバーを決める」種として使う。
 * 複雑な解のために用意した部品が、単純な解にちょうど必要だった。
 */
export function getDeviceId(): string {
  let id = localStorage.getItem(LS_DEVICE)
  if (!id) {
    id = 'd-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
    localStorage.setItem(LS_DEVICE, id)
  }
  return id
}

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

export function saveAssignment(a: Assignment): void {
  try {
    localStorage.setItem(LS_ASSIGNMENT, JSON.stringify(a))
  } catch {
    // 保存できなくても、そのセッションでは動く。
  }
}

export function clearAssignment(): void {
  localStorage.removeItem(LS_ASSIGNMENT)
}

export function loadMode(): VoiceMode {
  const raw = localStorage.getItem(LS_MODE)
  if (raw === 'ai' || raw === 'self-record' || raw === 'browser-tts') return raw
  return 'ai'
}

export function saveMode(mode: VoiceMode): void {
  try {
    localStorage.setItem(LS_MODE, mode)
  } catch {
    // 同上
  }
}
