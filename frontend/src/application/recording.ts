// 録音のユースケース。
//
// MediaRecorder の扱い（infrastructure/recorder.ts）を UI から隠す。
// 画面は「始める・終える・使えるか」だけを知っていればよい。

import {
  isRecordingSupported as canRecord,
  startRecording as startBrowserRecording,
  type ActiveRecorder,
} from '../infrastructure/recorder'
import { storeAudio } from './audioUrls'

/** この端末でブラウザ録音ができるか。 */
export function isRecordingSupported(): boolean {
  return canRecord()
}

/** いま録音中のもの（同時に1つだけ）。 */
let active: ActiveRecorder | null = null

export function isRecording(): boolean {
  return active !== null
}

/** マイクの許可を取り、録音を始める。 */
export async function startRecording(): Promise<void> {
  if (active) return
  active = await startBrowserRecording()
}

/** 録音を終えて Blob を返す。始まっていなければ null。 */
export async function stopRecording(): Promise<Blob | null> {
  if (!active) return null
  const recorder = active
  active = null
  const { blob } = await recorder.stop()
  return blob
}

/** 録音を捨てる（画面を離れるときなど）。 */
export function cancelRecording(): void {
  active?.cancel()
  active = null
}

/**
 * 1つのセリフに音声を紐づける（自分で録音モード）。
 * AI音声とまったく同じ置き場（IndexedDB）に入れるので、
 * 劇場も動画書き出しも両者を区別しない。
 */
export async function attachLineAudio(lineId: string, blob: Blob): Promise<void> {
  await storeAudio(lineId, blob)
}
