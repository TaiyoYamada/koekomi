import { useEffect, useState } from 'react'
import { StepHead } from '../components/StepHead'
import { Ruby } from '../components/Furigana'
import { Icon } from '../components/icons'
import { VoiceTryout } from '../components/VoiceTryout'
import { isRecordingSupported, startRecording, stopRecording } from '../../application/recording'
import {
  isBusy,
  setReferenceRecording,
  useGeneration,
  useReferenceAudioUrl,
  useVoice,
} from '../../application/voiceJobs'
import { REFERENCE_SCRIPT_LINES } from '../../domain/script'

function fmt(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

/** 声をろくおんする（AIの声のもとになる参照音声。1回だけ）。 */
export function Record() {
  const { hasRecording } = useVoice()
  const generation = useGeneration()
  const recordingUrl = useReferenceAudioUrl(hasRecording)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState(false)
  const supported = isRecordingSupported()
  const busy = isBusy()

  // 録音中は経過秒数をカウントアップ（録音中だと一目でわかるように）。
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [recording])

  async function onStart() {
    setError(false)
    try {
      await startRecording()
      setElapsed(0)
      setRecording(true)
    } catch (e) {
      setError(true)
      console.error(e)
    }
  }

  async function onStop() {
    const blob = await stopRecording()
    setRecording(false)
    if (blob) await setReferenceRecording(blob)
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) await setReferenceRecording(file)
  }

  return (
    <div>
      <StepHead
        title="声(こえ)を録音(ろくおん)する"
        hint={
          <Ruby text="下(した)の文(ぶん)を 声(こえ)に出(だ)して 読(よ)んでね。その声(こえ)でAIが 喋(しゃべ)るよ。" />
        }
      />

      <div className="card script-card">
        {REFERENCE_SCRIPT_LINES.map((line) => (
          <p key={line} className="script-text">
            {line}
          </p>
        ))}
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
      {busy && !recording && (
        <div className="banner warn">
          <Ruby text="いまAIが声(こえ)を作(つく)っているよ。終(お)わったら録(と)り直(なお)せるよ。" />
        </div>
      )}
      {generation.phase !== 'idle' && generation.error && (
        <div className="banner err">
          <Ruby text={generation.error} />
        </div>
      )}

      {/* 録音ボタンそのものが主役なので、コマでは囲まない。 */}
      <div className="card bare center">
        {recording && (
          <div className="rec-indicator" role="status">
            <span className="rec-dot" />
            <Ruby text="録音中(ろくおんちゅう)" />
            <span className="rec-time">{fmt(elapsed)}</span>
          </div>
        )}
        {!recording ? (
          <button
            className="btn rec big icon-btn"
            onClick={() => void onStart()}
            disabled={!supported || busy}
          >
            <Icon name="mic" size={26} />
            <Ruby text="録音(ろくおん)スタート" />
          </button>
        ) : (
          <button className="btn stop big icon-btn" onClick={() => void onStop()}>
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

      <VoiceTryout />

      <div className="card">
        <p className="step-hint" style={{ marginTop: 0 }}>
          <Ruby text="録音(ろくおん)できないときは、上(うえ)の文(ぶん)を読(よ)んで録音(ろくおん)した音声(おんせい)ファイルを選(えら)んでね。" />
        </p>
        <input type="file" accept="audio/*" onChange={(e) => void onUpload(e)} disabled={busy} />
      </div>
    </div>
  )
}
