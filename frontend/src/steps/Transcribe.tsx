import { useState } from 'react'
import { StepHead } from '../components/StepHead'
import { NavBar } from '../components/NavBar'
import { Ruby } from '../components/Furigana'
import { NEXT } from '../ui/labels'
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
        title="文字(もじ)にする"
        hint={<Ruby text="録音(ろくおん)した声(こえ)を文字(もじ)にしてみよう。違(ちが)うところは直(なお)せるよ。" />}
      />

      {error && <div className="banner err">{error}</div>}

      <div className="card center">
        <button className="btn big" onClick={run} disabled={busy || !assignment}>
          <Ruby
            text={busy ? '文字(もじ)にしているよ…' : done ? 'もう一度(いちど)文字(もじ)にする' : '🪄 文字(もじ)にする'}
          />
        </button>
        {busy && <div className="spinner" />}
      </div>

      {(done || referenceText) && (
        <div className="card">
          <p className="step-hint" style={{ marginTop: 0 }}>
            <Ruby text="直(なお)したいところはここで書(か)き直(なお)してね" />
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
        nextLabel={NEXT.toGenerate}
      />
    </div>
  )
}
