// クライアント側の動画書き出し（MediaRecorder）。**フォールバック専用**。
//
// canvas に写真と字幕を描き、その captureStream の映像トラックと、
// WebAudio でつないだ音声トラックを1本の MediaStream にまとめて録画する。
//
// 弱点は構造的で、直せない:
//   - 実時間でしか録画できない（60秒の作品は60秒かかる）
//   - タブが裏に回るとタイマーが絞られ、AudioContext も止まるので壊れる
//   - コーデックの可否が iPadOS のバージョンで変わる
// だからサーバー側レンダリング（/render）が使えるならそちらを使い、
// ここは「使えないとき」のためだけに残す。
//
// タイミングの計算は持たない。domain/timeline.ts が作った Segment[] を
// そのまま解釈するだけ（以前はここが独自にタイムラインを組み立てていて、
// 劇場の再生と二重実装になっていた）。

import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  segmentAt,
  totalDurationMs,
  type Segment,
} from '../domain/timeline'

/** 画面が真っ暗なときの背景色（.theater-screen と同じ）。サーバー側と一致させること。 */
const SCREEN_BG = '#0b0f17'

/** 描画のフレーム間隔（30fps 相当）。 */
const FRAME_INTERVAL_MS = 33
const FPS = 30
const MAX_SUBTITLE_LINES = 3

/** 出力形式の候補。mp4 を優先し、だめなら webm に落とす。 */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

export interface ClientExportOptions {
  segments: Segment[]
  /** panelPath → 画像URL（そのまま <img src> に渡せるもの）。 */
  panelUrls: Map<string, string>
  /** lineId → 音声の object URL。 */
  audioUrls: Map<string, string>
  onProgress?: (ratio: number) => void
  signal?: AbortSignal
}

export interface ClientExportResult {
  blob: Blob
  ext: 'mp4' | 'webm'
}

// ===== 能力判定 =====

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
export function isClientExportSupported(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  if (!('MediaRecorder' in window)) return false
  if (typeof document.createElement('canvas').captureStream !== 'function') return false
  const hasAudioCtx = 'AudioContext' in window || 'webkitAudioContext' in window
  if (!hasAudioCtx) return false
  return pickMimeType() !== null
}

// ===== 描画（サーバー側 _compose_frame と同じ見た目にする） =====

/** 写真を object-fit: cover 相当で敷いたときの描画位置。中央固定。 */
export function coverRect(
  iw: number,
  ih: number,
  w: number,
  h: number,
): { dx: number; dy: number; dw: number; dh: number } {
  const scale = Math.max(w / iw, h / ih)
  const dw = iw * scale
  const dh = ih * scale
  // +0 は -0 を 0 に均すため。
  return { dx: (w - dw) / 2 + 0, dy: (h - dh) / 2 + 0, dw, dh }
}

/** 字幕を折り返して行に分ける（日本語は1文字ずつ詰める）。 */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
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
  return lines.slice(0, MAX_SUBTITLE_LINES)
}

/** 1フレームを描く。写真が無ければ暗転、字幕が空なら字幕なし。 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | undefined,
  subtitle: string,
): void {
  const w = FRAME_WIDTH
  const h = FRAME_HEIGHT

  ctx.fillStyle = SCREEN_BG
  ctx.fillRect(0, 0, w, h)

  if (img) {
    const { dx, dy, dw, dh } = coverRect(img.naturalWidth, img.naturalHeight, w, h)
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

  // 下からの黒グラデーション。
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

function abortError(): DOMException {
  return new DOMException('中止しました', 'AbortError')
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function loadImage(src: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const onAbort = () => {
      img.src = '' // 読み込みを打ち切る
      reject(abortError())
    }
    const done = () => signal?.removeEventListener('abort', onAbort)
    signal?.addEventListener('abort', onAbort, { once: true })
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      done()
      resolve(img)
    }
    img.onerror = () => {
      done()
      reject(new Error(`画像を読み込めません: ${src}`))
    }
    img.src = src
  })
}

async function loadAudio(
  ac: AudioContext,
  url: string,
  signal?: AbortSignal,
): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    return await ac.decodeAudioData(await res.arrayBuffer())
  } catch {
    return null
  }
}

// ===== 本体 =====

/** 4コマ劇場を実時間で録画して動画の Blob を返す。 */
export async function recordTimeline(opts: ClientExportOptions): Promise<ClientExportResult> {
  const { segments, panelUrls, audioUrls, onProgress, signal } = opts

  const mime = pickMimeType()
  if (!mime) throw new Error('この端末では動画を保存できません。')
  const totalMs = totalDurationMs(segments)
  if (totalMs <= 0) throw new Error('書き出す内容がありません。')

  const AudioCtor: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ac = new AudioCtor()
  await ac.resume()

  try {
    // 1. 素材を先に全部読む（録画中に止まらないように）。
    // 声を読み込めないまま進むと「無音の動画」が黙って出来てしまうので、ここで止める。
    const buffers = new Map<string, AudioBuffer>()
    let failedVoices = 0
    for (const [lineId, url] of audioUrls) {
      throwIfAborted(signal)
      const buf = await loadAudio(ac, url, signal)
      throwIfAborted(signal)
      if (buf) buffers.set(lineId, buf)
      else failedVoices++
    }
    if (failedVoices > 0) {
      throw new Error(`セリフの声を${failedVoices}つ読み込めませんでした。もう一度ためしてね。`)
    }

    const images = new Map<string, HTMLImageElement>()
    for (const [path, url] of panelUrls) {
      throwIfAborted(signal)
      try {
        images.set(path, await loadImage(url, signal))
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
        // 読めない写真は暗転で通す。
      }
    }

    throwIfAborted(signal) // 録画を始める前の最後の関門。

    // 2. canvas と音声をつなぐ。
    const canvas = document.createElement('canvas')
    canvas.width = FRAME_WIDTH
    canvas.height = FRAME_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas を使えません。')

    const first = segments[0]
    drawFrame(ctx, images.get(first.panelPath ?? ''), '')

    const videoStream = canvas.captureStream(FPS)
    const dest = ac.createMediaStreamDestination()
    const stream = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ])

    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }

    // 録画データは stop() のときにまとめて届く。ここを待ち切らないと
    // 中身の無い（または途中で切れた）動画ができるので、必ず onstop を待つ。
    let finished = false
    let recError: Error | null = null
    const sources: AudioBufferSourceNode[] = []

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

    const stopped = new Promise<void>((resolve) => {
      rec.onstop = () => resolve()
      rec.onerror = () => {
        recError = new Error('録画に失敗しました。')
        finish()
      }
    })

    // 3. 音声を先に全部スケジュールしてから録画を始める。
    const startAt = ac.currentTime + 0.08
    for (const seg of segments) {
      if (!seg.lineId) continue
      const buf = buffers.get(seg.lineId)
      if (!buf) continue
      const src = ac.createBufferSource()
      src.buffer = buf
      src.connect(dest)
      src.start(startAt + seg.startMs / 1000)
      sources.push(src)
    }

    signal?.addEventListener('abort', finish)
    rec.start()
    const t0 = performance.now()

    // 4. 実時間で描き続ける。
    // requestAnimationFrame ではなくタイマーで回す。rAF はタブが裏に回ると止まり、
    // 音声だけ進んで映像が固まった動画ができてしまうため。
    let lastPct = -1
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const elapsed = performance.now() - t0
        if (finished || elapsed >= totalMs) {
          clearInterval(timer)
          finish()
          resolve()
          return
        }
        const seg = segmentAt(segments, elapsed)
        if (seg) drawFrame(ctx, images.get(seg.panelPath ?? ''), seg.subtitle)
        // 進捗は数字が変わったときだけ伝える（毎フレーム再描画させると中止ボタンが重くなる）。
        const pct = Math.min(100, Math.floor((elapsed / totalMs) * 100))
        if (pct !== lastPct) {
          lastPct = pct
          onProgress?.(pct / 100)
        }
      }, FRAME_INTERVAL_MS)
    })

    await stopped
    signal?.removeEventListener('abort', finish)
    onProgress?.(1)

    throwIfAborted(signal)
    if (recError) throw recError

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
