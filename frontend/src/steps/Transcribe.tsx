import { useState } from 'react'
import { StepHead } from '../components/StepHead'
import { NavBar } from '../components/NavBar'
import { useApp } from '../state'
import { transcribe } from '../lib/api'
import type { StepProps } from './types'

/** ステップ: ろくおんを もじにする（文字起こし→編集）。 */
export function Transcribe({ stepNumber, goNext, goBack }: StepProps) {
  const { assignment, recordingBlob, referenceText, setReferenceText } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function run() {
    if (!assignment || !recordingBlob) return
    setBusy(true)
    setError(null)
    try {
      const res = await transcribe(assignment.apiUrl, recordingBlob)
      setReferenceText(res.text)
      setDone(true)
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
        title="もじにする"
        hint="ろくおんした 声を もじに してみよう。ちがう ところは なおせるよ。"
      />

      {error && <div className="banner err">{error}</div>}

      <div className="card center">
        <button className="btn big" onClick={run} disabled={busy || !assignment}>
          {busy ? 'もじにしているよ…' : done ? 'もういちど もじにする' : '🪄 もじにする'}
        </button>
        {busy && <div className="spinner" />}
      </div>

      {(done || referenceText) && (
        <div className="card">
          <p className="step-hint" style={{ marginTop: 0 }}>
            なおしたい ところは ここで かきなおしてね
          </p>
          <textarea
            rows={3}
            value={referenceText}
            onChange={(e) => setReferenceText(e.target.value)}
          />
        </div>
      )}

      <NavBar
        onBack={goBack}
        onNext={goNext}
        nextDisabled={!referenceText.trim()}
        nextLabel="AIで声を作る →"
      />
    </div>
  )
}
