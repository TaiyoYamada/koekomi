import { useRef, useState } from 'react'
import { StepHead } from '../components/StepHead'
import { NavBar } from '../components/NavBar'
import { Ruby } from '../components/Furigana'
import { NEXT } from '../ui/labels'
import { findPanel, usePanels } from '../hooks/usePanels'
import { useApp } from '../state'
import { startRecording, isRecordingSupported, type ActiveRecorder } from '../lib/recorder'
import type { StepProps } from './types'

/** フォールバック1: 自分で録音モード（コマごとに自分の声をろくおん）。 */
export function SelfRecordComas({ stepNumber, goNext, goBack }: StepProps) {
  const { panels } = usePanels()
  const { selectedPanels, lines, comaVoiceUrls, setComaVoiceUrl } = useApp()
  const [recordingIdx, setRecordingIdx] = useState<number | null>(null)
  const activeRef = useRef<ActiveRecorder | null>(null)
  const supported = isRecordingSupported()

  async function start(i: number) {
    try {
      activeRef.current = await startRecording()
      setRecordingIdx(i)
    } catch {
      alert('マイクが使えませんでした')
    }
  }

  async function stop(i: number) {
    if (!activeRef.current) return
    const { blob } = await activeRef.current.stop()
    activeRef.current = null
    setRecordingIdx(null)
    // 以前のURLを片付ける
    const prev = comaVoiceUrls[i]
    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
    setComaVoiceUrl(i, URL.createObjectURL(blob))
  }

  function onUpload(i: number, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setComaVoiceUrl(i, URL.createObjectURL(file))
  }

  const anyDone = comaVoiceUrls.some((u) => !!u)

  return (
    <div>
      <StepHead
        num={stepNumber}
        title="自分(じぶん)で声(こえ)を録音(ろくおん)"
        hint={<Ruby text="コマごとにセリフを声(こえ)に出(だ)して録音(ろくおん)しよう" />}
      />
      {selectedPanels.map((pid, i) => {
        const panel = findPanel(panels, pid)
        const url = comaVoiceUrls[i]
        const isRec = recordingIdx === i
        return (
          <div className="card" key={pid}>
            <div className="line-row" style={{ margin: 0, boxShadow: 'none', padding: 0 }}>
              {panel && <img src={panel.src} alt={panel.label} />}
              <div style={{ flex: 1 }}>
                <div className="coma-no">
                  <Ruby text={`${i + 1}コマ目(め)`} />
                </div>
                <div style={{ fontWeight: 700 }}>{lines[i] || '（セリフなし）'}</div>
              </div>
            </div>
            <div className="row" style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {!isRec ? (
                <button className="btn rec" onClick={() => start(i)} disabled={!supported || recordingIdx !== null}>
                  <Ruby text="● 録音(ろくおん)" />
                </button>
              ) : (
                <button className="btn stop" onClick={() => stop(i)}>
                  ■ ストップ
                </button>
              )}
              <label className="btn secondary" style={{ display: 'inline-flex', alignItems: 'center' }}>
                ファイル
                <input type="file" accept="audio/*" hidden onChange={(e) => onUpload(i, e)} />
              </label>
            </div>
            {url && <audio src={url} controls style={{ width: '100%', marginTop: 12 }} />}
          </div>
        )
      })}
      <NavBar onBack={goBack} onNext={goNext} nextDisabled={!anyDone} nextLabel={NEXT.toTheater} />
    </div>
  )
}
