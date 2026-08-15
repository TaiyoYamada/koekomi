// 端末標準の読み上げ（speechSynthesis）を使うフォールバック。

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** 日本語の声をできるだけ選ぶ。 */
function pickJapaneseVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices()
  return voices.find((v) => v.lang?.toLowerCase().startsWith('ja')) ?? voices[0]
}

/** テキストを読み上げる。再生が終わると resolve する。 */
export function speak(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isSpeechSupported()) {
      reject(new Error('このブラウザは読み上げにたいおうしていません'))
      return
    }
    if (!text.trim()) {
      resolve()
      return
    }
    const u = new SpeechSynthesisUtterance(text)
    const v = pickJapaneseVoice()
    if (v) u.voice = v
    u.lang = v?.lang ?? 'ja-JP'
    u.rate = 1
    u.onend = () => resolve()
    u.onerror = () => resolve() // 失敗してもプレイヤーは止めない
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  })
}

/** 読み上げを止める。 */
export function stopSpeaking(): void {
  if (isSpeechSupported()) window.speechSynthesis.cancel()
}
