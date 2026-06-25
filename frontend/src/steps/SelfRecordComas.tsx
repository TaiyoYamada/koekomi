import { useRef, useState } from 'react'
import { StepHead } from '../components/StepHead'
import { Ruby } from '../components/Furigana'
import { Icon } from '../components/icons'
import { findPanel, usePanels } from '../hooks/usePanels'
import { useApp } from '../state'
import { startRecording, isRecordingSupported, type ActiveRecorder } from '../lib/recorder'

/** フォールバック1: 自分で録音モード（セリフごとに自分の声をろくおん）。 */
export function SelfRecordComas() {
  const { panels } = usePanels()
  const { comas, setLineVoice } = useApp()
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const activeRef = useRef<ActiveRecorder | null>(null)
  const supported = isRecordingSupported()

  async function start(lineId: string) {
    try {
      activeRef.current = await startRecording()
      setRecordingId(lineId)
    } catch {
      alert('マイクが使えませんでした')
    }
  }

  async function stop(lineId: string, prevUrl: string | null) {
    if (!activeRef.current) return
    const { blob } = await activeRef.current.stop()
    activeRef.current = null
    setRecordingId(null)
    if (prevUrl?.startsWith('blob:')) URL.revokeObjectURL(prevUrl)
    setLineVoice(lineId, URL.createObjectURL(blob))
  }

  function onUpload(lineId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setLineVoice(lineId, URL.createObjectURL(file))
  }

  return (
    <div>
      <StepHead
        title="自分(じぶん)で声(こえ)を録音(ろくおん)"
        hint={<Ruby text="セリフごとに声(こえ)に出(だ)して録音(ろくおん)しよう" />}
      />
      {comas.map((coma, ci) => {
        const panel = findPanel(panels, coma.panelId)
        return (
          <div className="card" key={ci}>
            <div className="line-row" style={{ margin: 0, boxShadow: 'none', padding: 0 }}>
              {panel && <img src={panel.src} alt={panel.label} />}
              <div className="coma-no">
                <Ruby text={`${ci + 1}枚目(まいめ)`} />
              </div>
            </div>
            {coma.lines
              .filter((l) => l.text.trim())
              .map((line) => {
                const isRec = recordingId === line.id
                return (
                  <div key={line.id} style={{ marginTop: 12 }}>
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
                          onClick={() => start(line.id)}
                          disabled={!supported || recordingId !== null}
                        >
                          <Icon name="mic" size={20} />
                          <Ruby text="録音(ろくおん)" />
                        </button>
                      ) : (
                        <button className="btn stop icon-btn" onClick={() => stop(line.id, line.voiceUrl)}>
                          <Icon name="stop" size={18} />
                          ストップ
                        </button>
                      )}
                      <label className="btn secondary" style={{ display: 'inline-flex', alignItems: 'center' }}>
                        ファイル
                        <input type="file" accept="audio/*" hidden onChange={(e) => onUpload(line.id, e)} />
                      </label>
                    </div>
                    {line.voiceUrl && <audio src={line.voiceUrl} controls style={{ width: '100%', marginTop: 8 }} />}
                  </div>
                )
              })}
            {coma.lines.every((l) => !l.text.trim()) && (
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
