// 4コマ劇場を動画（mp4）として書き出す。
//
// canvas に写真と字幕を描き、その captureStream の映像トラックと、
// WebAudio でつないだ音声トラックを1本の MediaStream にまとめて MediaRecorder に渡す。
// ffmpeg も追加ライブラリも使わない。
//
// 注意: MediaRecorder は実時間で録画する。劇場の再生と同じ長さだけ時間がかかる。
// 注意: 読み上げモード（speechSynthesis）の音声は MediaStream として取り出せないため書き出せない。
//       呼び出し側で書き出しボタンを出さないこと。

import type { Coma, Panel } from '../types'

/** 書き出しサイズ。劇場のスクリーンと同じ 16:10。 */
export const EXPORT_WIDTH = 1280
export const EXPORT_HEIGHT = 800

/** 音声のないセリフを映す時間（Theater の再生と同じ）。 */
export const SILENT_LINE_MS = 900
/** セリフとセリフの間。 */
export const LINE_GAP_MS = 150
/** コマが切り替わってからセリフが始まるまでの間。 */
export const COMA_LEAD_MS = 250
/** 最後のセリフのあと、余韻として足す時間。 */
export const TAIL_MS = 300
/** 描画のフレーム間隔（30fps 相当）。 */
const FRAME_INTERVAL_MS = 33
/** 録画のフレームレート。 */
const FPS = 30

/** 画面が真っ暗なときの背景色（.theater-screen と同じ）。 */
const SCREEN_BG = '#0b0f17'

/** 出力形式の候補。mp4 を優先し、だめなら webm に落とす。 */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

/** 動画1区間ぶんの指示。字幕が空文字なら字幕を出さない。 */
export interface Segment {
  comaIndex: number
  subtitle: string
  /** この区間の頭で鳴らす音声。 */
  lineId: string | null
  startMs: number
  durMs: number
}

export interface ExportOptions {
  comas: Coma[]
  panels: Panel[]
  gapSec: number
  onProgress?: (ratio: number) => void
  signal?: AbortSignal
}

export interface ExportResult {
  blob: Blob
  ext: 'mp4' | 'webm'
}

// ===== 純粋な計算（テスト対象） =====

/**
 * 写真を object-fit: cover 相当で敷いたときの描画位置を求める。
 * focusY は object-position の Y%（0=上 / 50=中央 / 100=下）。
 */
export function coverRect(
  iw: number,
  ih: number,
  w: number,
  h: number,
  focusY: number,
): { dx: number; dy: number; dw: number; dh: number } {
  const scale = Math.max(w / iw, h / ih)
  const dw = iw * scale
  const dh = ih * scale
  // +0 は -0 を 0 に均すため。
  return { dx: (w - dw) / 2 + 0, dy: (h - dh) * (focusY / 100) + 0, dw, dh }
}

/**
 * 劇場の再生順（Theater.tsx の play / playComa）をそのまま時間軸に並べる。
 * durations はセリフ id → 音声の長さ(ms)。無い場合は SILENT_LINE_MS を使う。
 */
export function buildTimeline(
  comas: Coma[],
  durations: Map<string, number>,
  gapSec: number,
): Segment[] {
  const segs: Segment[] = []
  let t = 0
  const push = (comaIndex: number, subtitle: string, lineId: string | null, durMs: number) => {
    if (durMs <= 0) return
    segs.push({ comaIndex, subtitle, lineId, startMs: t, durMs })
    t += durMs
  }

  comas.forEach((coma, ci) => {
    // コマが切り替わった直後は字幕なし。
    push(ci, '', null, COMA_LEAD_MS)

    const lines = coma.lines.filter((l) => l.text.trim() || l.voiceUrl)
    lines.forEach((line) => {
      push(ci, line.text, line.id, durations.get(line.id) ?? SILENT_LINE_MS)
      // セリフの間は字幕を出したままにする（Theater と同じ挙動）。
      push(ci, line.text, null, LINE_GAP_MS)
    })

    // 次のコマまでの間。字幕は消す。
    if (ci < comas.length - 1) push(ci, '', null, Math.round(gapSec * 1000))
  })

  return segs
}

/** タイムライン全体の長さ（余韻込み）。 */
export function totalDurationMs(segs: Segment[]): number {
  if (segs.length === 0) return 0
  const last = segs[segs.length - 1]
  return last.startMs + last.durMs + TAIL_MS
}

/** ある時刻に表示すべき区間を返す。 */
export function segmentAt(segs: Segment[], ms: number): Segment | undefined {
  for (const s of segs) {
    if (ms >= s.startMs && ms < s.startMs + s.durMs) return s
  }
  return segs[segs.length - 1]
}

/** 使える出力形式を選ぶ。判定関数を差し替えられるようにしてテストしやすくする。 */
export function pickMimeType(isSupported?: (t: string) => boolean): string | null {
  const check =
    isSupported ??
    ((t: string) =>
      typeof MediaRecorder !== 'undefined' &&
      typeof MediaRecorder.isTypeSupported === 'function' &&
      MediaRecorder.isTypeSupported(t))
  for (const t of MIME_CANDIDATES) {
    if (check(t)) return t
  }
  return null
}

export function extensionFor(mime: string): 'mp4' | 'webm' {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm'
}

/** この端末で書き出せるか。 */
export function isVideoExportSupported(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  if (!('MediaRecorder' in window)) return false
  if (typeof document.createElement('canvas').captureStream !== 'function') return false
  const hasAudioCtx = 'AudioContext' in window || 'webkitAudioContext' in window
  if (!hasAudioCtx) return false
  return pickMimeType() !== null
}

// ===== 描画 =====

/** 字幕を折り返して行に分ける。 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  // 日本語は単語区切りが無いので1文字ずつ詰める。
  for (const ch of text) {
    const next = line + ch
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line)
      line = ch
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, 3)
}

/** 1フレームを描く。写真が無ければ暗転、字幕が空なら字幕なし。 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | undefined,
  focusY: number,
  subtitle: string,
): void {
  const w = EXPORT_WIDTH
  const h = EXPORT_HEIGHT

  ctx.fillStyle = SCREEN_BG
  ctx.fillRect(0, 0, w, h)

  if (img) {
    const { dx, dy, dw, dh } = coverRect(img.naturalWidth, img.naturalHeight, w, h, focusY)
    ctx.drawImage(img, dx, dy, dw, dh)
  }

  if (!subtitle) return

  const fontSize = Math.round(w * 0.042)
  ctx.font = `900 ${fontSize}px system-ui, -apple-system, "Hiragino Sans", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  const lines = wrapText(ctx, subtitle, w * 0.88)
  const lineHeight = Math.round(fontSize * 1.5)
  const bottomPad = Math.round(h * 0.045)
  const blockTop = h - bottomPad - lineHeight * lines.length

  // 下からの黒グラデーション（.theater-subtitle と同じ狙い）。
  const gradTop = Math.max(0, blockTop - fontSize * 1.6)
  const grad = ctx.createLinearGradient(0, h, 0, gradTop)
  grad.addColorStop(0, 'rgba(0,0,0,0.78)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, gradTop, w, h - gradTop)

  ctx.shadowColor = 'rgba(0,0,0,0.9)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 2
  ctx.fillStyle = '#fff'
  lines.forEach((ln, i) => {
    ctx.fillText(ln, w / 2, blockTop + lineHeight * (i + 1) - fontSize * 0.35)
  })
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
}

// ===== 読み込み =====

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`画像を読み込めません: ${src}`))
    img.src = src
  })
}

/** 音声を取ってきてデコードする。失敗したら null（無音扱いで先に進む）。 */
async function loadAudio(ac: AudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    return await ac.decodeAudioData(buf)
  } catch {
    return null
  }
}

// ===== 本体 =====

/** 4コマ劇場を録画して動画の Blob を返す。 */
export async function exportTheaterVideo(opts: ExportOptions): Promise<ExportResult> {
  const { comas, panels, gapSec, onProgress, signal } = opts

  const mime = pickMimeType()
  if (!mime) throw new Error('この端末では動画を保存できません。')

  const AudioCtor: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ac = new AudioCtor()
  await ac.resume()

  try {
    // 1. 素材をぜんぶ先に読み込む（録画中に止まらないように）。
    // 声を読み込めないまま進むと「無音の動画」が黙って出来てしまうので、ここで止める。
    const buffers = new Map<string, AudioBuffer>()
    let failedVoices = 0
    for (const coma of comas) {
      for (const line of coma.lines) {
        if (!line.voiceUrl) continue
        const buf = await loadAudio(ac, line.voiceUrl)
        if (buf) buffers.set(line.id, buf)
        else failedVoices++
      }
    }
    if (failedVoices > 0) {
      throw new Error(`セリフの声を${failedVoices}つ読み込めませんでした。もう一度ためしてね。`)
    }
    if (signal?.aborted) throw new DOMException('中止しました', 'AbortError')

    const images = new Map<string, HTMLImageElement>()
    for (const coma of comas) {
      if (!coma.panelId || images.has(coma.panelId)) continue
      const panel = panels.find((p) => p.id === coma.panelId)
      if (!panel) continue
      try {
        images.set(coma.panelId, await loadImage(panel.src))
      } catch {
        // 読めない写真は暗転で通す。
      }
    }
    if (signal?.aborted) throw new DOMException('中止しました', 'AbortError')

    // 2. 時間軸を組む。
    const durations = new Map<string, number>()
    for (const [id, buf] of buffers) durations.set(id, Math.round(buf.duration * 1000))
    const segs = buildTimeline(comas, durations, gapSec)
    const totalMs = totalDurationMs(segs)
    if (totalMs <= 0) throw new Error('書き出す内容がありません。')

    // 3. canvas と音声をつなぐ。
    const canvas = document.createElement('canvas')
    canvas.width = EXPORT_WIDTH
    canvas.height = EXPORT_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas を使えません。')

    const first = segs[0]
    drawFrame(ctx, images.get(comas[first.comaIndex].panelId ?? ''), comas[first.comaIndex].focusY, '')

    const videoStream = canvas.captureStream(FPS)
    const dest = ac.createMediaStreamDestination()
    const stream = new MediaStream([...videoStream.getVideoTracks(), ...dest.stream.getAudioTracks()])

    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    const stopped = new Promise<void>((resolve) => {
      rec.onstop = () => resolve()
    })

    // 4. 音声を先に全部スケジュールしてから録画を始める。
    const sources: AudioBufferSourceNode[] = []
    const startAt = ac.currentTime + 0.08
    for (const seg of segs) {
      if (!seg.lineId) continue
      const buf = buffers.get(seg.lineId)
      if (!buf) continue
      const src = ac.createBufferSource()
      src.buffer = buf
      src.connect(dest)
      src.start(startAt + seg.startMs / 1000)
      sources.push(src)
    }

    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      for (const s of sources) {
        try {
          s.stop()
        } catch {
          // 未再生のソースは stop で例外になることがある。無視してよい。
        }
      }
      if (rec.state !== 'inactive') rec.stop()
    }
    signal?.addEventListener('abort', finish)

    rec.start()
    const t0 = performance.now()

    // 5. 実時間で描き続ける。
    // requestAnimationFrame ではなくタイマーで回す。rAF はタブが裏に回ると止まり、
    // 音声だけ進んで映像が固まった動画ができてしまうため。
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const elapsed = performance.now() - t0
        if (finished || elapsed >= totalMs) {
          clearInterval(timer)
          finish()
          resolve()
          return
        }
        const seg = segmentAt(segs, elapsed)
        if (seg) {
          const coma = comas[seg.comaIndex]
          drawFrame(ctx, images.get(coma.panelId ?? ''), coma.focusY, seg.subtitle)
        }
        onProgress?.(Math.min(1, elapsed / totalMs))
      }, FRAME_INTERVAL_MS)
    })

    await stopped
    signal?.removeEventListener('abort', finish)
    onProgress?.(1)

    if (signal?.aborted) throw new DOMException('中止しました', 'AbortError')

    const blob = new Blob(chunks, { type: mime })
    if (blob.size === 0) throw new Error('動画を録画できませんでした。')
    return { blob, ext: extensionFor(mime) }
  } finally {
    void ac.close()
  }
}

/** Blob をファイルとして保存する。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Safari が読み終える前に revoke すると落ちるので少し待つ。
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
