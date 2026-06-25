import { useEffect, useRef, useState } from 'react'
import { StepHead } from '../components/StepHead'
import { Ruby } from '../components/Furigana'
import { Icon } from '../components/icons'
import { findPanel, usePanels } from '../hooks/usePanels'
import { useApp } from '../state'
import { speak, stopSpeaking } from '../lib/speech'
import type { Line } from '../types'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 4コマ劇場プレイヤー。
 * - 既定は手動：1コマずつめくる（▶でそのコマを再生）。
 * - 「自動でめくる」をオンにすると、間（ま）の秒数をあけて最後まで進む。
 */
export function Theater() {
  const { panels } = usePanels()
  const { comas, mode } = useApp()
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [auto, setAuto] = useState(false)
  const [gapSec, setGapSec] = useState(1)
  const [playingLineId, setPlayingLineId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const cancelRef = useRef(false)

  useEffect(() => {
    return () => {
      cancelRef.current = true
      stopSpeaking()
      audioRef.current?.pause()
    }
  }, [])

  function playLine(line: Line): Promise<void> {
    return new Promise((resolve) => {
      setPlayingLineId(line.id)
      if (mode === 'browser-tts') {
        speak(line.text || '').then(resolve)
        return
      }
      if (!line.voiceUrl) {
        setTimeout(resolve, 900)
        return
      }
      const a = new Audio(line.voiceUrl)
      audioRef.current = a
      a.onended = () => resolve()
      a.onerror = () => resolve()
      a.play().catch(() => resolve())
    })
  }

  async function playComa(ci: number) {
    const lines = comas[ci].lines.filter((l) => l.text.trim() || l.voiceUrl)
    for (const line of lines) {
      if (cancelRef.current) break
      await playLine(line)
      if (cancelRef.current) break
      await wait(150)
    }
    setPlayingLineId(null)
  }

  async function play(startCi: number) {
    cancelRef.current = false
    setPlaying(true)
    for (let ci = startCi; ci < comas.length; ci++) {
      if (cancelRef.current) break
      setCurrent(ci)
      await wait(250)
      if (cancelRef.current) break
      await playComa(ci)
      if (!auto || cancelRef.current) break // 手動は1コマで止まる
      if (ci < comas.length - 1) await wait(gapSec * 1000)
    }
    setPlaying(false)
  }

  function stop() {
    cancelRef.current = true
    stopSpeaking()
    audioRef.current?.pause()
    setPlaying(false)
    setPlayingLineId(null)
  }

  function go(ci: number) {
    stop()
    setCurrent(Math.max(0, Math.min(comas.length - 1, ci)))
  }

  const coma = comas[current]
  const panel = findPanel(panels, coma.panelId)
  const visibleLines = coma.lines.filter((l) => l.text.trim() || l.voiceUrl)

  // 映画の字幕のように、いま喋っているセリフを写真の下に1つだけ流す。
  // 停止中は最初のセリフをプレビュー表示する。
  const activeLine = playingLineId ? coma.lines.find((l) => l.id === playingLineId) : null
  const subtitle = activeLine ? activeLine.text : playing ? '' : (visibleLines[0]?.text ?? '')

  return (
    <div className="theater">
      <StepHead
        title="4コマ劇場(げきじょう)を見(み)る"
        hint={<Ruby text="1コマずつめくって見(み)よう。自動(じどう)でめくることもできるよ。" />}
      />

      <div className="theater-screen">
        {panel ? <img src={panel.src} alt={panel.label} /> : <div className="theater-noimg" />}
        {subtitle && (
          <div className={'theater-subtitle' + (activeLine ? ' speaking' : '')}>{subtitle}</div>
        )}
      </div>

      {/* コマ選び */}
      <div className="coma-tabs">
        {comas.map((_, i) => (
          <button key={i} className={'t' + (i === current ? ' active' : '')} onClick={() => go(i)}>
            {i + 1}
          </button>
        ))}
      </div>

      {/* 再生コントロール */}
      <div className="card center">
        <div className="player-row">
          <button className="btn secondary" onClick={() => go(current - 1)} disabled={current === 0}>
            <Ruby text="◀ 前(まえ)" />
          </button>
          {!playing ? (
            <button className="btn icon-btn" onClick={() => play(current)}>
              <Icon name="play" size={22} />
              <Ruby text="再生(さいせい)" />
            </button>
          ) : (
            <button className="btn stop icon-btn" onClick={stop}>
              <Icon name="stop" size={20} />
              <Ruby text="止(と)める" />
            </button>
          )}
          <button
            className="btn secondary"
            onClick={() => go(current + 1)}
            disabled={current === comas.length - 1}
          >
            <Ruby text="次(つぎ) ▶" />
          </button>
        </div>

        <div className="player-options">
          <label className="opt">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            <Ruby text="自動(じどう)でめくる" />
          </label>
          <div className="opt">
            <Ruby text="間(ま)" />
            <button className="mini" onClick={() => setGapSec((s) => Math.max(0.5, +(s - 0.5).toFixed(1)))}>
              －
            </button>
            <span className="gap-val">{gapSec.toFixed(1)}秒</span>
            <button className="mini" onClick={() => setGapSec((s) => Math.min(5, +(s + 0.5).toFixed(1)))}>
              ＋
            </button>
          </div>
        </div>
      </div>

      {mode === 'browser-tts' && (
        <div className="banner warn">
          <Ruby text="今(いま)は「読(よ)み上(あ)げモード」です。端末(たんまつ)の声(こえ)でセリフを読(よ)み上(あ)げます。" />
        </div>
      )}
    </div>
  )
}
