import { useEffect, useRef, useState } from 'react'
import { StepHead } from '../components/StepHead'
import { Ruby } from '../components/Furigana'
import { Icon } from '../components/icons'
import { useApp } from '../state'
import { isRecordingSupported, startRecording, type ActiveRecorder } from '../lib/recorder'
import { REFERENCE_SCRIPT } from '../lib/script'

function fmt(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

/** 声をろくおんする（AIの声のもとになる参照音声。1回だけ）。 */
export function Record() {
  const { recordingUrl, setRecording } = useApp()
  const [recording, setRecordingState] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState(false)
  const activeRef = useRef<ActiveRecorder | null>(null)
  const supported = isRecordingSupported()

  // 録音中は経過秒数をカウントアップ（録音中だと一目でわかるように）。
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [recording])

  async function onStart() {
    setError(false)
    try {
      activeRef.current = await startRecording()
      setElapsed(0)
      setRecordingState(true)
    } catch (e) {
      setError(true)
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
        title="声(こえ)を録音(ろくおん)する"
        hint={<Ruby text="下(した)の文(ぶん)を こえに出(だ)して 読(よ)んでね。その声(こえ)でAIが しゃべるよ。" />}
      />

      <div className="card script-card">
        <p className="script-text">{REFERENCE_SCRIPT}</p>
      </div>

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
        {recording && (
          <div className="rec-indicator" role="status">
            <span className="rec-dot" />
            <Ruby text="録音中(ろくおんちゅう)" />
            <span className="rec-time">{fmt(elapsed)}</span>
          </div>
        )}
        {!recording ? (
          <button className="btn rec big icon-btn" onClick={onStart} disabled={!supported}>
            <Icon name="mic" size={26} />
            <Ruby text="録音(ろくおん)スタート" />
          </button>
        ) : (
          <button className="btn stop big icon-btn" onClick={onStop}>
            <Icon name="stop" size={24} />
            <Ruby text="ここを押(お)して 終(お)わる" />
          </button>
        )}

        {recordingUrl && !recording && (
          <div style={{ marginTop: 18 }}>
            <p className="step-hint">
              <Ruby text="聞(き)いてみよう" />
            </p>
            <audio src={recordingUrl} controls style={{ width: '100%' }} />
          </div>
        )}
      </div>

      <div className="card">
        <p className="step-hint" style={{ marginTop: 0 }}>
          <Ruby text="録音(ろくおん)できないときは、おうちの人(ひと)や先生(せんせい)に聞(き)いて音声(おんせい)ファイルを選(えら)んでね。" />
        </p>
        <input type="file" accept="audio/*" onChange={onUpload} />
      </div>
    </div>
  )
}
