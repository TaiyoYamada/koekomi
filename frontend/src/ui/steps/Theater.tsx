import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { StepHead } from '../components/StepHead'
import { Ruby } from '../components/Furigana'
import { Icon } from '../components/icons'
import { findPanel, panelPathResolver, usePanels } from '../usePanels'
import { buildTimeline, segmentsOfComa } from '../../domain/timeline'
import { MAX_TITLE_LENGTH } from '../../domain/work'
import { durationMap, ensureDurations, useDurations } from '../../application/durations'
import { preloadAll } from '../../application/audioUrls'
import { goToComa, play, stop, usePlayer } from '../../application/player'
import {
  canExport,
  exportVideo,
  fileFor,
  saveOutcome,
  shareUrlFor,
  type ExportMethod,
  type ExportOutcome,
} from '../../application/videoExport'
import { useMode, useTitle, useUi, useWork, workActions } from '../../application/workStore'

/**
 * 4コマ劇場プレイヤー。
 *
 * 再生順・字幕・間はすべて domain/timeline.ts が決める。この画面は
 * 「組み上がったタイムラインを映す」だけで、独自のタイミング計算を持たない。
 * 書き出した動画とプレビューが必ず一致するのはそのため。
 */
export function Theater() {
  const { panels } = usePanels()
  const work = useWork()
  const title = useTitle()
  const mode = useMode()
  const { autoPlay: auto, active } = useUi()
  const player = usePlayer()
  const durations = useDurations()

  const [exporting, setExporting] = useState(false)
  const [aborting, setAborting] = useState(false)
  const [exportPct, setExportPct] = useState(0)
  const [exportMethod, setExportMethod] = useState<ExportMethod | null>(null)
  const [exportError, setExportError] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const [outcome, setOutcome] = useState<ExportOutcome | null>(null)
  const [sharing, setSharing] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [qr, setQr] = useState<{ img: string; expiresSec: number } | null>(null)
  const [qrOpen, setQrOpen] = useState(false)

  // 読み上げモードの声（speechSynthesis）は録音できないので書き出せない。
  const exportable = useMemo(() => mode !== 'browser-tts' && canExport(), [mode])

  // AirDrop（共有シート）でファイルを送れる環境か。
  const canShareFiles = useMemo(() => {
    if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false
    try {
      return navigator.canShare({ files: [new File([], 'koekomi.mp4', { type: 'video/mp4' })] })
    } catch {
      return false
    }
  }, [])

  // 音声の長さを測り、手元に読み込んでおく（再生の頭で音が出ない空白を作らない）。
  useEffect(() => {
    const refs = Object.values(work.lines).map((l) => ({ lineId: l.id, audio: l.audio }))
    void ensureDurations(refs)
    void preloadAll(refs.map((r) => r.audio))
  }, [work.lines])

  const timeline = useMemo(
    () =>
      buildTimeline({
        work,
        panelPath: panelPathResolver(panels),
        durations: durationMap(durations),
        auto,
      }),
    [work, panels, durations, auto],
  )

  // 作品や再生設定が変わったら、書き出し済みの動画は古くなるので捨てる。
  useEffect(() => {
    setOutcome(null)
    setQr(null)
    setQrOpen(false)
  }, [timeline])

  // 別のタブへ移ったら再生だけ止める（書き出しは裏で続ける）。
  useEffect(() => {
    if (active !== 'theater') stop()
  }, [active])

  useEffect(() => () => stop(), [])

  const comaCount = work.comas.length
  const current = Math.min(player.comaIndex, comaCount - 1)
  const coma = work.comas[current]
  const panel = findPanel(panels, coma?.panelId ?? null)

  /** そのコマの最初のセリフ（停止中のプレビューに出す）。 */
  const firstSubtitleOf = useCallback(
    (index: number) => segmentsOfComa(timeline, index).find((s) => s.subtitle)?.subtitle ?? '',
    [timeline],
  )

  function onPlay() {
    // 自動めくりなら現在のコマから最後まで、手動ならそのコマだけ。
    const segments = auto
      ? timeline.filter((s) => s.comaIndex >= current)
      : segmentsOfComa(timeline, current)
    void play(segments)
  }

  function go(index: number) {
    goToComa(Math.max(0, Math.min(comaCount - 1, index)))
  }

  function cancelExport() {
    setAborting(true)
    abortRef.current?.abort()
  }

  async function runExport() {
    stop()
    setExportError(false)
    setExportPct(0)
    setAborting(false)
    setExportMethod(null)
    setExporting(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const panelUrls = new Map<string, string>()
      for (const p of panels) panelUrls.set(p.src, p.src)
      const result = await exportVideo({
        segments: timeline,
        panelUrls,
        signal: ctrl.signal,
        onMethod: setExportMethod,
        onProgress: (r) => setExportPct(Math.round(r * 100)),
      })
      setOutcome(result)
      await saveOutcome(result, title)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        console.error(e) // 詳細は画面に出さず、コンソールにだけ残す。
        setExportError(true)
      }
    } finally {
      setExporting(false)
      setAborting(false)
      setExportMethod(null)
      abortRef.current = null
    }
  }

  async function showQr() {
    if (!outcome) return
    if (qr) {
      setQrOpen(true)
      return
    }
    setSendError(null)
    setSharing(true)
    try {
      const { url, expiresSec } = await shareUrlFor(outcome)
      const img = await QRCode.toDataURL(url, { width: 640, margin: 2 })
      setQr({ img, expiresSec })
      setQrOpen(true)
    } catch (e) {
      console.error(e)
      setSendError('動画(どうが)を 送(おく)れなかったよ。もう一度(いちど) ためしてね。')
    } finally {
      setSharing(false)
    }
  }

  async function shareFile() {
    if (!outcome) return
    setSendError(null)
    setSharing(true)
    try {
      const file = await fileFor(outcome, title)
      await navigator.share({ files: [file] })
    } catch (e) {
      // 共有シートを閉じただけ（AbortError）は何もしない。
      if (e instanceof DOMException && e.name === 'AbortError') return
      console.error(e)
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        setSendError(
          'この端末(たんまつ)では 共有(きょうゆう)できなかったよ。QRコードを 使(つか)ってね。',
        )
        return
      }
      setSendError('動画(どうが)を 送(おく)れなかったよ。もう一度(いちど) ためしてね。')
    } finally {
      setSharing(false)
    }
  }

  // 再生中はプレイヤーが字幕を決める。停止中は「そのコマの最初のセリフ」を
  // タイムラインから導く（プレイヤーの状態に頼らない。作品を開いた直後や
  // 再生し終わった直後でも、何のセリフなのかが見えるように）。
  const subtitle = player.playing ? player.subtitle : firstSubtitleOf(current)

  return (
    <div className="theater">
      <StepHead
        title="4コマ劇場(げきじょう)を見(み)る"
        hint={
          <Ruby
            text={
              auto
                ? '再生(さいせい)すると 最後(さいご)まで 続(つづ)けて 見(み)られるよ。'
                : '1コマずつめくって見(み)よう。'
            }
          />
        }
        action={
          outcome && !exporting ? (
            <div className="head-actions">
              <button
                className="btn secondary small"
                onClick={() => void showQr()}
                disabled={sharing}
              >
                <Ruby text={sharing ? 'じゅんびしているよ…' : 'QRコードで送(おく)る'} />
              </button>
              {canShareFiles && (
                <button
                  className="btn secondary small"
                  onClick={() => void shareFile()}
                  disabled={sharing}
                >
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
          maxLength={MAX_TITLE_LENGTH}
          placeholder="タイトルを かいてね"
          onChange={(e) => workActions.setTitle(e.target.value)}
          aria-label="作品のタイトル"
        />
      </div>

      <div className="theater-screen">
        {panel ? <img src={panel.src} alt={panel.label} /> : <div className="theater-noimg" />}
        {subtitle && (
          <div className={'theater-subtitle' + (player.activeLineId ? ' speaking' : '')}>
            {subtitle}
          </div>
        )}

        {exportable &&
          (!exporting ? (
            <button
              className="screen-action"
              onClick={() => void runExport()}
              disabled={player.playing}
            >
              <Ruby text="動画(どうが)で保存(ほぞん)" />
            </button>
          ) : (
            <button className="screen-action recording" onClick={cancelExport} disabled={aborting}>
              <Icon name="stop" size={14} />
              <Ruby
                text={
                  aborting
                    ? 'とめているよ…'
                    : exportMethod === 'server'
                      ? '作(つく)っているよ…'
                      : `録画中(ろくがちゅう) ${exportPct}%`
                }
              />
            </button>
          ))}
      </div>

      {exporting && (
        <p className="export-hint">
          <Ruby
            text={
              exportMethod === 'server'
                ? 'サーバーで 動画(どうが)を 作(つく)っているよ。すぐ できるよ。'
                : '最初(さいしょ)から流(なが)して録画(ろくが)しているよ。終(お)わるまで待(ま)ってね。'
            }
          />
        </p>
      )}

      {/* コマ選び */}
      <div className="coma-tabs">
        {work.comas.map((c, i) => (
          <button
            key={c.id}
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
          {!player.playing ? (
            <button className="btn icon-btn" onClick={onPlay} disabled={exporting}>
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
            disabled={current === comaCount - 1 || exporting}
          >
            <Ruby text="次(つぎ) ▶" />
          </button>
        </div>

        <div className="player-options">
          <label className="opt auto-toggle">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => workActions.setAutoPlay(e.target.checked)}
            />
            <Ruby text="自動(じどう)でめくる" />
          </label>
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
