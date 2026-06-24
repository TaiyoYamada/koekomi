import { useRef, useState } from 'react'
import { StepHead } from '../components/StepHead'
import { NavBar } from '../components/NavBar'
import { useApp } from '../state'
import { isRecordingSupported, startRecording, type ActiveRecorder } from '../lib/recorder'
import type { StepProps } from './types'

/** ステップ: 声をろくおんする（AIの声のもとになる参照音声）。 */
export function Record({ stepNumber, goNext, goBack }: StepProps) {
  const { recordingBlob, recordingUrl, setRecording } = useApp()
  const [recording, setRecordingState] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeRef = useRef<ActiveRecorder | null>(null)
  const supported = isRecordingSupported()

  async function onStart() {
    setError(null)
    try {
      activeRef.current = await startRecording()
      setRecordingState(true)
    } catch (e) {
      setError('マイクを つかえませんでした。せっていを かくにんしてね。')
      console.error(e)
    }
  }

  async function onStop() {
    if (!activeRef.current) return
    const { blob } = await activeRef.current.stop()
    activeRef.current = null
    setRecordingState(false)
    setRecording(blob)
  }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setRecording(file)
  }

  return (
    <div>
      <StepHead
        num={stepNumber}
        title="声をろくおんする"
        hint="「こんにちは、わたしの 名まえは ○○です」のように 話してみてね"
      />

      {!supported && (
        <div className="banner warn">
          このブラウザは ろくおんに たいおうしていないかも。下の「ファイルをえらぶ」をつかってね。
        </div>
      )}
      {error && <div className="banner err">{error}</div>}

      <div className="card center">
        {!recording ? (
          <button className="btn rec big" onClick={onStart} disabled={!supported}>
            ● ろくおん スタート
          </button>
        ) : (
          <button className="btn stop big" onClick={onStop}>
            ■ ろくおん ストップ
          </button>
        )}

        {recordingUrl && !recording && (
          <div style={{ marginTop: 18 }}>
            <p className="step-hint">きいてみよう👇</p>
            <audio src={recordingUrl} controls style={{ width: '100%' }} />
          </div>
        )}
      </div>

      <div className="card">
        <p className="step-hint" style={{ marginTop: 0 }}>
          ろくおんできない ときは、おうちの人や 先生に きいて 音声ファイルを えらんでね（ほけん）。
        </p>
        <input type="file" accept="audio/*" onChange={onUpload} />
      </div>

      <NavBar
        onBack={goBack}
        onNext={goNext}
        nextDisabled={!recordingBlob}
        nextLabel="もじにする →"
      />
    </div>
  )
}
