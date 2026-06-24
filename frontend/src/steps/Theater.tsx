import { useEffect, useRef, useState } from 'react'
import { StepHead } from '../components/StepHead'
import { NavBar } from '../components/NavBar'
import { findPanel, usePanels } from '../hooks/usePanels'
import { useApp } from '../state'
import { speak, stopSpeaking } from '../lib/speech'
import type { StepProps } from './types'

/**
 * ステップ: 4コマげきじょうを見る。
 * 1コマずつ「絵＋セリフ＋音声」を順番に再生する。
 * - ai / self-record: comaVoiceUrls の音声を再生
 * - browser-tts: speechSynthesis で lines を読み上げ
 */
export function Theater({ stepNumber, goBack }: StepProps) {
  const { panels } = usePanels()
  const { selectedPanels, lines, comaVoiceUrls, mode } = useApp()
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const cancelRef = useRef(false)

  const total = selectedPanels.length

  useEffect(() => {
    return () => {
      cancelRef.current = true
      stopSpeaking()
      audioRef.current?.pause()
    }
  }, [])

  /** 1コマ分を再生し終わるまで待つ。 */
  function playOne(i: number): Promise<void> {
    return new Promise((resolve) => {
      if (mode === 'browser-tts') {
        speak(lines[i] || '').then(resolve)
        return
      }
      const url = comaVoiceUrls[i]
      if (!url) {
        // 音声がない場合は少し見せてから次へ。
        setTimeout(resolve, 1500)
        return
      }
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => resolve()
      audio.onerror = () => resolve()
      audio.play().catch(() => resolve())
    })
  }

  async function playAll() {
    cancelRef.current = false
    setPlaying(true)
    for (let i = 0; i < total; i++) {
      if (cancelRef.current) break
      setCurrent(i)
      // 絵の切り替えを見せるため少し待つ
      await new Promise((r) => setTimeout(r, 350))
      if (cancelRef.current) break
      await playOne(i)
    }
    setPlaying(false)
  }

  function stopAll() {
    cancelRef.current = true
    stopSpeaking()
    audioRef.current?.pause()
    setPlaying(false)
  }

  const panel = findPanel(panels, selectedPanels[current])

  return (
    <div className="theater">
      <StepHead num={stepNumber} title="4コマげきじょうを見る" hint="さいしょから じゅんばんに さいせいするよ" />

      <div className="theater-stage">
        {panel && <img src={panel.src} alt={panel.label} />}
        <div className="theater-bubble">{lines[current] || '　'}</div>
      </div>

      <div className="coma-tabs">
        {selectedPanels.map((_, i) => (
          <button
            key={i}
            className={'t' + (i === current ? ' active' : '')}
            onClick={() => {
              stopAll()
              setCurrent(i)
            }}
          >
            {i + 1}
          </button>
        ))}
      </div>

      <div className="card center">
        {!playing ? (
          <button className="btn big" onClick={playAll}>
            ▶ さいしょから さいせい
          </button>
        ) : (
          <button className="btn stop big" onClick={stopAll}>
            ■ とめる
          </button>
        )}
        <button
          className="btn secondary"
          style={{ marginTop: 12 }}
          onClick={() => {
            stopAll()
            playOne(current)
          }}
        >
          🔁 この コマだけ もういちど
        </button>
      </div>

      {mode === 'browser-tts' && (
        <div className="banner warn">いまは「読み上げモード」です。端末の声で セリフを 読み上げます。</div>
      )}

      <NavBar onBack={goBack} backLabel="← なおす" hideBack={false} />
    </div>
  )
}
