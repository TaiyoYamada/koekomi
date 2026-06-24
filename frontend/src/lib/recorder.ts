// MediaRecorder を使った録音ヘルパー（iPad Safari 対応）。

/** iPad Safari でも通りやすい mimeType を選ぶ。 */
function pickMimeType(): string | undefined {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4', // iOS Safari はこちらになることが多い
    'audio/aac',
  ]
  // MediaRecorder.isTypeSupported が無い環境もある。
  const isSupported = (window as any).MediaRecorder?.isTypeSupported
  if (typeof isSupported === 'function') {
    for (const c of candidates) {
      if (isSupported.call(MediaRecorder, c)) return c
    }
  }
  return undefined // ブラウザ任せ
}

export interface ActiveRecorder {
  stop: () => Promise<{ blob: Blob; mimeType: string }>
  cancel: () => void
}

/** ブラウザが録音に対応しているか。 */
export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== 'undefined' &&
    'MediaRecorder' in window
  )
}

/** マイクの許可を取り、録音を開始する。 */
export async function startRecording(): Promise<ActiveRecorder> {
  if (!isRecordingSupported()) {
    throw new Error('このブラウザは録音にたいおうしていません')
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType = pickMimeType()
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream)
  const chunks: BlobPart[] = []
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }
  recorder.start()

  const stopStream = () => stream.getTracks().forEach((t) => t.stop())

  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          const type = recorder.mimeType || mimeType || 'audio/webm'
          const blob = new Blob(chunks, { type })
          stopStream()
          resolve({ blob, mimeType: type })
        }
        recorder.stop()
      }),
    cancel: () => {
      try {
        recorder.stop()
      } catch {
        /* noop */
      }
      stopStream()
    },
  }
}
