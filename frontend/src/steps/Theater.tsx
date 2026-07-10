import { useEffect, useMemo, useRef, useState } from 'react'
import { StepHead } from '../components/StepHead'
import { Ruby } from '../components/Furigana'
import { Icon } from '../components/icons'
import { findPanel, usePanels } from '../hooks/usePanels'
import { useApp } from '../state'
import { speak, stopSpeaking } from '../lib/speech'
import { downloadBlob, exportTheaterVideo, isVideoExportSupported } from '../lib/export-video'
import type { Line } from '../types'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 4コマ劇場プレイヤー。
 * - 既定は手動：1コマずつめくる（▶でそのコマを再生）。
 * - 「自動でめくる」をオンにすると、間（ま）の秒数をあけて最後まで進む。
 */
export function Theater() {
  const { panels } = usePanels()
  const { comas, mode, autoPlay: auto, setAutoPlay: setAuto, gapSec, setGapSec } = useApp()
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playingLineId, setPlayingLineId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const cancelRef = useRef(false)

  const [exporting, setExporting] = useState(false)
  const [exportPct, setExportPct] = useState(0)
  const [exportError, setExportError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 読み上げモードの声（speechSynthesis）は録音できないので、書き出しは出さない。
  const canExport = useMemo(() => mode !== 'browser-tts' && isVideoExportSupported(), [mode])

  useEffect(() => {
    return () => {
      cancelRef.current = true
      stopSpeaking()
      audioRef.current?.pause()
      abortRef.current?.abort()
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

  async function saveVideo() {
    stop()
    setExportError(null)
    setExportPct(0)
    setExporting(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const { blob, ext } = await exportTheaterVideo({
        comas,
        panels,
        gapSec,
        signal: ctrl.signal,
        onProgress: (r) => setExportPct(Math.round(r * 100)),
      })
      downloadBlob(blob, `koekomi-4koma.${ext}`)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setExportError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setExporting(false)
      abortRef.current = null
    }
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
        {panel ? (
          <img src={panel.src} alt={panel.label} style={{ objectPosition: `50% ${coma.focusY}%` }} />
        ) : (
          <div className="theater-noimg" />
        )}
        {subtitle && (
          <div className={'theater-subtitle' + (activeLine ? ' speaking' : '')}>{subtitle}</div>
        )}

        {canExport &&
          (!exporting ? (
            <button className="screen-action" onClick={() => void saveVideo()} disabled={playing}>
              <Icon name="film" size={16} />
              <Ruby text="動画(どうが)で保存(ほぞん)" />
            </button>
          ) : (
            <button className="screen-action recording" onClick={() => abortRef.current?.abort()}>
              <Icon name="stop" size={14} />
              <Ruby text={`録画中(ろくがちゅう) ${exportPct}%`} />
            </button>
          ))}
      </div>

      {exporting && (
        <p className="export-hint">
          <Ruby text="最初(さいしょ)から流(なが)して録画(ろくが)しているよ。終(お)わるまで待(ま)ってね。" />
        </p>
      )}

      {/* コマ選び */}
      <div className="coma-tabs">
        {comas.map((_, i) => (
          <button
            key={i}
            className={'t' + (i === current ? ' active' : '')}
            onClick={() => go(i)}
            disabled={exporting}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* 再生コントロール */}
      <div className="card center">
        <div className="player-row">
          <button
            className="btn secondary"
            onClick={() => go(current - 1)}
            disabled={current === 0 || exporting}
          >
            <Ruby text="◀ 前(まえ)" />
          </button>
          {!playing ? (
            <button className="btn icon-btn" onClick={() => play(current)} disabled={exporting}>
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
            disabled={current === comas.length - 1 || exporting}
          >
            <Ruby text="次(つぎ) ▶" />
          </button>
        </div>

        <div className="player-options">
          <label className="opt auto-toggle">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            <Ruby text="自動(じどう)でめくる" />
          </label>
          {auto && (
            <div className="opt gap-ctrl">
              <Ruby text="つぎのコマまで" />
              <button
                className="mini"
                aria-label="間をみじかく"
                onClick={() => setGapSec(Math.max(0.5, +(gapSec - 0.5).toFixed(1)))}
              >
                －
              </button>
              <span className="gap-val">{gapSec.toFixed(1)}秒</span>
              <button
                className="mini"
                aria-label="間をながく"
                onClick={() => setGapSec(Math.min(5, +(gapSec + 0.5).toFixed(1)))}
              >
                ＋
              </button>
            </div>
          )}
        </div>

      </div>

      {exportError && (
        <div className="banner err">
          <Ruby text="動画(どうが)を保存(ほぞん)できませんでした。" /> {exportError}
        </div>
      )}

      {mode === 'browser-tts' && (
        <div className="banner warn">
          <Ruby text="今(いま)は「読(よ)み上(あ)げモード」です。端末(たんまつ)の声(こえ)でセリフを読(よ)み上(あ)げます。" />
        </div>
      )}
    </div>
  )
}
