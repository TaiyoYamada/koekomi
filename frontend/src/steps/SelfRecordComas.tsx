import { useRef, useState } from 'react'
import { StepHead } from '../components/StepHead'
import { NavBar } from '../components/NavBar'
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
      alert('マイクを つかえませんでした')
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
        title="自分で声をろくおん"
        hint="コマごとに セリフを 声に だして ろくおんしよう"
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
                <div className="coma-no">{i + 1}コマめ</div>
                <div style={{ fontWeight: 700 }}>{lines[i] || '（セリフなし）'}</div>
              </div>
            </div>
            <div className="row" style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {!isRec ? (
                <button className="btn rec" onClick={() => start(i)} disabled={!supported || recordingIdx !== null}>
                  ● ろくおん
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
      <NavBar onBack={goBack} onNext={goNext} nextDisabled={!anyDone} nextLabel="4コマげきじょうを見る →" />
    </div>
  )
}
