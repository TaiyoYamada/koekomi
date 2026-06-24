import { useRef, useState } from 'react'
import { StepHead } from '../components/StepHead'
import { NavBar } from '../components/NavBar'
import { Ruby } from '../components/Furigana'
import { NEXT } from '../ui/labels'
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
        title="声(こえ)を録音(ろくおん)する"
        hint={<Ruby text="「こんにちは、私(わたし)の名前(なまえ)は○○です」のように話(はな)してみてね" />}
      />

      {!supported && (
        <div className="banner warn">
          <Ruby text="このブラウザは録音(ろくおん)に対応(たいおう)していないかも。下(した)の「ファイルを選(えら)ぶ」を使(つか)ってね。" />
        </div>
      )}
      {error && (
        <div className="banner err">
          <Ruby text="マイクが使(つか)えませんでした。設定(せってい)を確認(かくにん)してね。" />
        </div>
      )}

      <div className="card center">
        {!recording ? (
          <button className="btn rec big" onClick={onStart} disabled={!supported}>
            <Ruby text="● 録音(ろくおん)スタート" />
          </button>
        ) : (
          <button className="btn stop big" onClick={onStop}>
            <Ruby text="■ 録音(ろくおん)ストップ" />
          </button>
        )}

        {recordingUrl && !recording && (
          <div style={{ marginTop: 18 }}>
            <p className="step-hint">
              <Ruby text="聞(き)いてみよう👇" />
            </p>
            <audio src={recordingUrl} controls style={{ width: '100%' }} />
          </div>
        )}
      </div>

      <div className="card">
        <p className="step-hint" style={{ marginTop: 0 }}>
          <Ruby text="録音(ろくおん)できないときは、おうちの人(ひと)や先生(せんせい)に聞(き)いて音声(おんせい)ファイルを選(えら)んでね（保険(ほけん)）。" />
        </p>
        <input type="file" accept="audio/*" onChange={onUpload} />
      </div>

      <NavBar onBack={goBack} onNext={goNext} nextDisabled={!recordingBlob} nextLabel={NEXT.toTranscribe} />
    </div>
  )
}
