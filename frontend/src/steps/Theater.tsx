import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { StepHead } from '../components/StepHead'
import { Ruby } from '../components/Furigana'
import { Icon } from '../components/icons'
import { findPanel, usePanels } from '../hooks/usePanels'
import { useApp } from '../state'
import { speak, stopSpeaking } from '../lib/speech'
import { fileUrl, uploadVideo } from '../lib/api'
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
  const { comas, mode, autoPlay: auto, setAutoPlay: setAuto, gapSec, setGapSec, title, setTitle, active, assignment } =
    useApp()
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playingLineId, setPlayingLineId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const cancelRef = useRef(false)

  const [exporting, setExporting] = useState(false)
  const [exportPct, setExportPct] = useState(0)
  const [exportError, setExportError] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // 書き出し済みの動画（別端末への送信に使い回す）。
  const [lastExport, setLastExport] = useState<{ blob: Blob; ext: 'mp4' | 'webm' } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  // アップロード済みQRのキャッシュ（同じ動画を二度アップロードしない）。
  const [qr, setQr] = useState<{ img: string; expiresSec: number } | null>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const qrForRef = useRef<Blob | null>(null)

  // 読み上げモードの声（speechSynthesis）は録音できないので、書き出しは出さない。
  const canExport = useMemo(() => mode !== 'browser-tts' && isVideoExportSupported(), [mode])

  // AirDrop（共有シート）でファイルを送れる環境か（iPad/iPhone の Safari など）。
  const canShareFiles = useMemo(() => {
    if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false
    try {
      return navigator.canShare({ files: [new File([], 'koekomi.mp4', { type: 'video/mp4' })] })
    } catch {
      return false
    }
  }, [])

  // 作品や再生設定が変わったら、書き出し済みの動画は古くなるので捨てる。
  useEffect(() => {
    setLastExport(null)
    setQr(null)
    setQrOpen(false)
    qrForRef.current = null
  }, [comas, gapSec])

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

  // 別のタブへ移ったら再生だけ止める（動画の書き出しは裏で続ける）。
  useEffect(() => {
    if (active !== 'theater') stop()
  }, [active])

  function go(ci: number) {
    stop()
    setCurrent(Math.max(0, Math.min(comas.length - 1, ci)))
  }

  /** タイトルが書いてあればファイル名に使う（ファイル名に使えない文字は除く）。 */
  function exportFileName(ext: string): string {
    const safe = title.trim().replace(/[\\/:*?"<>|]/g, '')
    return `${safe || 'koekomi-4koma'}.${ext}`
  }

  async function saveVideo() {
    stop()
    setExportError(false)
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
      downloadBlob(blob, exportFileName(ext))
      // 別端末への送信（QR / AirDrop）に使い回せるよう保持しておく。
      setLastExport({ blob, ext })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        console.error(e) // 詳細は画面に出さず、コンソールにだけ残す。
        setExportError(true)
      }
    } finally {
      setExporting(false)
      abortRef.current = null
    }
  }

  /** 動画を Colab に一時保存し、ダウンロードURLのQRコードを表示する。 */
  async function sendQr() {
    if (!lastExport || !assignment) return
    // 同じ動画をアップロード済みならQRを出し直すだけ。
    if (qr && qrForRef.current === lastExport.blob) {
      setQrOpen(true)
      return
    }
    setSendError(null)
    setUploading(true)
    try {
      const { filename, expiresSec } = await uploadVideo(assignment.apiUrl, lastExport.blob, lastExport.ext)
      const link = fileUrl(assignment.apiUrl, filename)
      const img = await QRCode.toDataURL(link, { width: 640, margin: 2 })
      qrForRef.current = lastExport.blob
      setQr({ img, expiresSec })
      setQrOpen(true)
    } catch (e) {
      console.error(e) // HTTPコード等の詳細は画面に出さない。
      setSendError('動画(どうが)を 送(おく)れなかったよ。もう一度(いちど) ためしてね。')
    } finally {
      setUploading(false)
    }
  }

  /** AirDrop（共有シート）で動画を送る。 */
  async function shareVideo() {
    if (!lastExport) return
    setSendError(null)
    const file = new File([lastExport.blob], exportFileName(lastExport.ext), {
      type: lastExport.blob.type || `video/${lastExport.ext}`,
    })
    try {
      await navigator.share({ files: [file] })
    } catch (e) {
      // 共有シートを閉じただけ（AbortError）は何もしない。
      if (e instanceof DOMException && e.name === 'AbortError') return
      console.error(e)
      // この端末では共有が許可されていない（デスクトップChrome等）。QRを案内する。
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        setSendError('この端末(たんまつ)では 共有(きょうゆう)できなかったよ。QRコードを 使(つか)ってね。')
        return
      }
      setSendError('動画(どうが)を 送(おく)れなかったよ。もう一度(いちど) ためしてね。')
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
        action={
          lastExport && !exporting && (assignment || canShareFiles) ? (
            <div className="head-actions">
              {assignment && (
                <button
                  className="btn secondary small"
                  onClick={() => void sendQr()}
                  disabled={uploading}
                >
                  <Ruby text={uploading ? 'じゅんびしているよ…' : 'QRコードで送(おく)る'} />
                </button>
              )}
              {canShareFiles && (
                <button className="btn secondary small" onClick={() => void shareVideo()}>
                  <Ruby text="AirDropで送(おく)る" />
                </button>
              )}
            </div>
          ) : undefined
        }
      />

      {sendError && (
        <div className="banner err">
          <Ruby text={sendError} />
        </div>
      )}

      {/* 作品タイトル（書ける。保存もされる） */}
      <div className="theater-title">
        <input
          type="text"
          value={title}
          maxLength={30}
          placeholder="タイトルを かいてね"
          onChange={(e) => setTitle(e.target.value)}
          aria-label="作品のタイトル"
        />
      </div>

      <div className="theater-screen">
        {panel ? (
          <img src={panel.src} alt={panel.label} />
        ) : (
          <div className="theater-noimg" />
        )}
        {subtitle && (
          <div className={'theater-subtitle' + (activeLine ? ' speaking' : '')}>{subtitle}</div>
        )}

        {canExport &&
          (!exporting ? (
            <button className="screen-action" onClick={() => void saveVideo()} disabled={playing}>
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
          <Ruby text="動画(どうが)を 保存(ほぞん)できなかったよ。もう一度(いちど) ためしてね。" />
        </div>
      )}

      {/* QRコード表示（受け取る側がカメラで読む） */}
      {qrOpen && qr && (
        <div className="picker-overlay" onClick={() => setQrOpen(false)}>
          <div className="picker-card qr-card" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <strong>
                <Ruby text="QRコードで受(う)け取(と)る" />
              </strong>
              <button className="btn secondary" onClick={() => setQrOpen(false)}>
                <Ruby text="閉(と)じる" />
              </button>
            </div>
            <img className="qr-img" src={qr.img} alt="動画ダウンロード用QRコード" />
            <p className="step-hint">
              <Ruby text="別(べつ)の端末(たんまつ)のカメラで読(よ)み取(と)ってね。" />
            </p>
            <p className="step-hint">
              <Ruby
                text={`動画(どうが)は ${Math.round(qr.expiresSec / 60)}分(ぷん)たつと 自動(じどう)で消(き)えるよ。`}
              />
            </p>
          </div>
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
