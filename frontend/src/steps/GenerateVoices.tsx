import { useState } from 'react'
import { StepHead } from '../components/StepHead'
import { NavBar } from '../components/NavBar'
import { useApp } from '../state'
import { fileUrl, generateComicVoices } from '../lib/api'
import type { StepProps } from './types'

/** ステップ: AIで声を作る（4コマぶんの音声を生成）。 */
export function GenerateVoices({ stepNumber, goNext, goBack }: StepProps) {
  const { assignment, recordingBlob, referenceText, lines, comaVoiceUrls, setComaVoiceUrl } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allDone = comaVoiceUrls.every((u) => !!u)

  async function run() {
    if (!assignment || !recordingBlob) return
    setBusy(true)
    setError(null)
    try {
      const res = await generateComicVoices(assignment.apiUrl, {
        audio: recordingBlob,
        referenceText,
        lines: [lines[0], lines[1], lines[2], lines[3]],
      })
      res.files.forEach((name, i) => setComaVoiceUrl(i, fileUrl(assignment.apiUrl, name)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <StepHead
        num={stepNumber}
        title="AIで声を作る"
        hint="あなたの 声を つかって、4つの セリフを しゃべる 声を 作るよ"
      />

      {error && (
        <div className="banner err">
          うまく いかなかったよ: {error}
          <br />
          先生に 言って、別の サーバーに つなぎなおすか、フォールバックモードを つかってね。
        </div>
      )}

      <div className="card center">
        <button className="btn big" onClick={run} disabled={busy || !assignment}>
          {busy ? '声を 作っているよ…' : allDone ? 'もういちど 作る' : '🎙️ 声を作る'}
        </button>
        {busy && (
          <>
            <div className="spinner" />
            <p className="step-hint">じゅんばんに 作っているよ。すこし まってね。</p>
          </>
        )}
      </div>

      {allDone && (
        <div className="card">
          <div className="banner ok">できたよ！1つずつ きいてみよう。</div>
          {comaVoiceUrls.map((u, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div className="coma-no">{i + 1}コマめ：{lines[i] || '（なし）'}</div>
              {u && <audio src={u} controls style={{ width: '100%' }} />}
            </div>
          ))}
        </div>
      )}

      <NavBar
        onBack={goBack}
        onNext={goNext}
        nextDisabled={!allDone}
        nextLabel="4コマげきじょうを見る →"
      />
    </div>
  )
}
