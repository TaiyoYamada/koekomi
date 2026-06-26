// FastAPI バックエンド（Colab + ngrok）との通信。

import type { GenerateVoicesResponse } from '../types'

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

/**
 * セリフぶんの AI 音声を生成する。
 * 録音音声（参照）・参照テキスト・任意個数のセリフを送り、同じ順番で音声ファイル名が返る。
 *
 * timeoutMs を過ぎても返らなければ中断してエラーにする（混雑・ハングで無限待ちにしない）。
 * サーバー側のタイムアウト（GEN_TIMEOUT_SEC、既定180秒）より少し長めにしておき、
 * 通常はサーバーの 504 を受け取り、最後の保険としてこちらが中断する。
 */
export async function generateComicVoices(
  apiUrl: string,
  params: {
    audio: Blob
    referenceText: string
    lines: string[]
  },
  timeoutMs = 210_000,
): Promise<GenerateVoicesResponse> {
  const fd = new FormData()
  fd.append('audio', params.audio, 'reference.webm')
  fd.append('reference_text', params.referenceText)
  // 可変個数のセリフを同じキー 'lines' で送る（順番は保持される）。
  for (const line of params.lines) fd.append('lines', line)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${base(apiUrl)}/generate-comic-voices`, {
      method: 'POST',
      headers: commonHeaders,
      body: fd,
      signal: ctrl.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('AI音声の生成がtimeoutしました。混んでいるかもしれません。もう一度お試しください。')
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error(`AI音声の生成に失敗しました (HTTP ${res.status})`)
  return (await res.json()) as GenerateVoicesResponse
}

/** 生成物の後片付けを依頼する（任意）。 */
export async function cleanup(apiUrl: string): Promise<void> {
  await fetch(`${base(apiUrl)}/cleanup`, { method: 'POST', headers: commonHeaders })
}
