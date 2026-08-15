import { useState } from 'react'
import { StepHead } from '../components/StepHead'
import { Ruby } from '../components/Furigana'
import { Icon } from '../components/icons'
import { findPanel, usePanels } from '../usePanels'
import { useAudioUrl } from '../../application/audioUrls'
import { useComas, useWork, workActions } from '../../application/workStore'
import {
  attachLineAudio,
  isRecordingSupported,
  startRecording,
  stopRecording,
} from '../../application/recording'
import { linesOf } from '../../domain/work'
import type { Line } from '../../domain/work'

function LineRecorder({
  line,
  recordingId,
  onStart,
  onStop,
  onUpload,
  supported,
}: {
  line: Line
  recordingId: string | null
  onStart: (lineId: string) => void
  onStop: (lineId: string) => void
  onUpload: (lineId: string, file: File) => void
  supported: boolean
}) {
  const url = useAudioUrl(line.audio)
  const isRec = recordingId === line.id
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 700 }}>{line.text}</div>
      {isRec && (
        <div className="rec-indicator" role="status" style={{ marginTop: 8 }}>
          <span className="rec-dot" />
          <Ruby text="録音中(ろくおんちゅう)" />
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        {!isRec ? (
          <button
            className="btn rec icon-btn"
            onClick={() => onStart(line.id)}
            disabled={!supported || recordingId !== null}
          >
            <Icon name="mic" size={20} />
            <Ruby text="録音(ろくおん)" />
          </button>
        ) : (
          <button className="btn stop icon-btn" onClick={() => onStop(line.id)}>
            <Icon name="stop" size={18} />
            ストップ
          </button>
        )}
        <label className="btn secondary" style={{ display: 'inline-flex', alignItems: 'center' }}>
          ファイル
          <input
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onUpload(line.id, file)
            }}
          />
        </label>
      </div>
      {url && <audio src={url} controls style={{ width: '100%', marginTop: 8 }} />}
    </div>
  )
}

/** フォールバック1: 自分で録音モード（セリフごとに自分の声をろくおん）。 */
export function SelfRecordComas() {
  const { panels } = usePanels()
  const comas = useComas()
  const work = useWork()
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [micError, setMicError] = useState(false)
  const supported = isRecordingSupported()

  async function start(lineId: string) {
    setMicError(false)
    try {
      await startRecording()
      setRecordingId(lineId)
    } catch (e) {
      console.error(e)
      setMicError(true)
    }
  }

  async function stop(lineId: string) {
    const blob = await stopRecording()
    setRecordingId(null)
    if (blob) await save(lineId, blob)
  }

  async function save(lineId: string, blob: Blob) {
    await attachLineAudio(lineId, blob)
    workActions.setLineAudio(lineId, { kind: 'stored', key: lineId })
  }

  return (
    <div>
      <StepHead
        title="自分(じぶん)で声(こえ)を録音(ろくおん)"
        hint={<Ruby text="セリフごとに声(こえ)に出(だ)して録音(ろくおん)しよう" />}
      />
      {micError && (
        <div className="banner err">
          <Ruby text="マイクが使(つか)えませんでした。設定(せってい)を確認(かくにん)してね。" />
        </div>
      )}
      {comas.map((coma, ci) => {
        const panel = findPanel(panels, coma.panelId)
        const lines = linesOf(work, coma).filter((l) => l.text.trim())
        return (
          <div className="card" key={coma.id}>
            <div className="line-row" style={{ margin: 0, boxShadow: 'none', padding: 0 }}>
              {panel && <img src={panel.src} alt={panel.label} />}
              <div className="coma-no">
                <Ruby text={`${ci + 1}枚目(まいめ)`} />
              </div>
            </div>
            {lines.map((line) => (
              <LineRecorder
                key={line.id}
                line={line}
                recordingId={recordingId}
                supported={supported}
                onStart={(id) => void start(id)}
                onStop={(id) => void stop(id)}
                onUpload={(id, file) => void save(id, file)}
              />
            ))}
            {lines.length === 0 && (
              <p className="step-hint" style={{ margin: '8px 0 0' }}>
                <Ruby text="（このコマはセリフが無(な)いよ）" />
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
