import { useEffect, useRef, useState } from 'react'
import { StepHead } from '../components/StepHead'
import { NavBar } from '../components/NavBar'
import { Ruby } from '../components/Furigana'
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
      <StepHead
        num={stepNumber}
        title="4コマ劇場(げきじょう)を見(み)る"
        hint={<Ruby text="最初(さいしょ)から順番(じゅんばん)に再生(さいせい)するよ" />}
      />

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
            <Ruby text="▶ 最初(さいしょ)から再生(さいせい)" />
          </button>
        ) : (
          <button className="btn stop big" onClick={stopAll}>
            <Ruby text="■ 止(と)める" />
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
          <Ruby text="🔁 このコマだけもう一度(いちど)" />
        </button>
      </div>

      {mode === 'browser-tts' && (
        <div className="banner warn">
          <Ruby text="今(いま)は「読(よ)み上(あ)げモード」です。端末(たんまつ)の声(こえ)でセリフを読(よ)み上(あ)げます。" />
        </div>
      )}

      <NavBar onBack={goBack} backLabel="← 直(なお)す" hideBack={false} />
    </div>
  )
}
