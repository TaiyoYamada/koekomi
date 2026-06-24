// FastAPI バックエンド（Colab + ngrok）との通信。

import type { GenerateVoicesResponse, TranscribeResponse } from '../types'

/** 末尾スラッシュを除いた apiUrl を返す。 */
function base(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, '')
}

/** /files/{filename} の完全な URL を組み立てる。 */
export function fileUrl(apiUrl: string, filename: string): string {
  return `${base(apiUrl)}/files/${encodeURIComponent(filename)}`
}

/** /health を叩いて到達できるか確認する（timeout 付き）。 */
export async function checkHealth(apiUrl: string, timeoutMs = 5000): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${base(apiUrl)}/health`, {
      signal: ctrl.signal,
      // ngrok の警告ページを避ける（ブラウザ向けヘッダ）。
      headers: { 'ngrok-skip-browser-warning': 'true' },
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

const commonHeaders = { 'ngrok-skip-browser-warning': 'true' }

/** 録音音声を送って文字起こしする。 */
export async function transcribe(apiUrl: string, audio: Blob): Promise<TranscribeResponse> {
  const fd = new FormData()
  fd.append('audio', audio, 'recording.webm')
  const res = await fetch(`${base(apiUrl)}/transcribe`, {
    method: 'POST',
    headers: commonHeaders,
    body: fd,
  })
  if (!res.ok) throw new Error(`文字起こしに失敗しました (HTTP ${res.status})`)
  return (await res.json()) as TranscribeResponse
}

/**
 * 4コマぶんの AI 音声を生成する。
 * 録音音声（参照）・参照テキスト・4つのセリフを送る。
 */
export async function generateComicVoices(
  apiUrl: string,
  params: {
    audio: Blob
    referenceText: string
    lines: [string, string, string, string]
  },
): Promise<GenerateVoicesResponse> {
  const fd = new FormData()
  fd.append('audio', params.audio, 'reference.webm')
  fd.append('reference_text', params.referenceText)
  fd.append('line1', params.lines[0])
  fd.append('line2', params.lines[1])
  fd.append('line3', params.lines[2])
  fd.append('line4', params.lines[3])
  const res = await fetch(`${base(apiUrl)}/generate-comic-voices`, {
    method: 'POST',
    headers: commonHeaders,
    body: fd,
  })
  if (!res.ok) throw new Error(`AI音声の生成に失敗しました (HTTP ${res.status})`)
  return (await res.json()) as GenerateVoicesResponse
}

/** 生成物の後片付けを依頼する（任意）。 */
export async function cleanup(apiUrl: string): Promise<void> {
  await fetch(`${base(apiUrl)}/cleanup`, { method: 'POST', headers: commonHeaders })
}
