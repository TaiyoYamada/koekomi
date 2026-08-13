// アプリアイコン一式を1枚のマスター画像から書き出す。
//
// マスターは assets/icon-master.png（正方形・余白込み・背景まで塗り切ったもの）。
// アイコンを差し替えるときは、マスターを置き換えて再実行するだけでよい。
// public/ ではなく assets/ に置くのは、マスター自体を配信物に含めないため。
//
//   実行: npm run icons   (または node frontend/scripts/generate-icons.mjs)

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, '../public')
const master = resolve(__dirname, '../assets/icon-master.png')

if (!existsSync(master)) {
  console.error(`マスター画像が見つかりません: ${master}`)
  process.exit(1)
}

/** 背景色（マスターの地色と揃えること）。透過部分とパディングを埋める。 */
const BG = '#ff7a1a'

/** favicon の角丸の比率（iOS のアイコンに近い 22%）。 */
const CORNER_RATIO = 0.22

// 書き出すサイズ一覧。
// apple-touch-icon は iOS がホーム画面で使うもので、SVG は読めないため PNG が必須。
// maskable は Android が円などに切り抜くため、絵柄を縮めて安全域（中央80%）に収める。
//
// rounded を付けるのは favicon だけ。ブラウザのタブは画像をそのまま出すので、
// 角を丸めたいなら画像側で丸めるしかない。逆に apple-touch-icon と maskable は
// OS が自分で丸めるので、ここで丸めると角が二重に落ちて欠けてしまう。
const targets = [
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-512-maskable.png', size: 512, maskable: true },
  { file: 'favicon-32.png', size: 32, rounded: true },
  { file: 'favicon-64.png', size: 64, rounded: true },
]

/** 角丸の外側を透明にするマスク（白い部分だけが残る）。 */
function cornerMask(size) {
  const r = Math.round(size * CORNER_RATIO)
  return Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`,
  )
}

const { width, height } = await sharp(master).metadata()
if (width !== height) {
  console.warn(`警告: マスターが正方形ではありません (${width}x${height})。中央でトリミングします。`)
}

for (const { file, size, maskable, rounded } of targets) {
  // 透明を許さない（iOS はアルファを黒く落とすため、必ず背景を敷く）。
  const base = sharp(master).flatten({ background: BG })

  const out = maskable
    ? // 絵柄を78%に縮め、残りを背景色で埋めて安全域を確保する。
      base
        .resize(Math.round(size * 0.78), Math.round(size * 0.78), { fit: 'cover' })
        .extend({
          top: Math.round(size * 0.11),
          bottom: size - Math.round(size * 0.78) - Math.round(size * 0.11),
          left: Math.round(size * 0.11),
          right: size - Math.round(size * 0.78) - Math.round(size * 0.11),
          background: BG,
        })
    : base.resize(size, size, { fit: 'cover', position: 'center' })

  // 角を落とすぶんだけ、その外側は透明に戻す。
  const shaped = rounded
    ? out.ensureAlpha().composite([{ input: cornerMask(size), blend: 'dest-in' }])
    : out

  await shaped.png({ compressionLevel: 9 }).toFile(resolve(publicDir, file))
  const notes = [maskable && 'maskable', rounded && '角丸'].filter(Boolean).join(' / ')
  console.log(`書き出しました: ${file} (${size}x${size})${notes ? ` [${notes}]` : ''}`)
}

// ------------------------------------------------------------------
// アプリ内で使うマスコット画像（背景を抜いたキャラ単体）。
// アイコンと同じ絵柄を Home / Sidebar でも使うために、地色のオレンジを
// 外周から塗りつぶして透過させる。内側にある似た色（ほっぺ等）を消さないよう、
// 色で一括判定するのではなく外周から連結している領域だけを抜く。
// ------------------------------------------------------------------

/** 背景と見なす色差の閾値。輪郭のアンチエイリアスまで拾えるよう広めに取る。 */
const BG_TOLERANCE = 60

const { data, info } = await sharp(master).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const { width: w, height: h, channels: ch } = info
const at = (x, y) => (y * w + x) * ch
const bg = [data[0], data[1], data[2]] // 左上の画素を地色とみなす

const isBg = (i) => {
  const dr = data[i] - bg[0]
  const dg = data[i + 1] - bg[1]
  const db = data[i + 2] - bg[2]
  return Math.sqrt(dr * dr + dg * dg + db * db) < BG_TOLERANCE
}

// 画像の四辺を種にした塗りつぶし（フラッドフィル）。
const seen = new Uint8Array(w * h)
const stack = []
for (let x = 0; x < w; x++) stack.push([x, 0], [x, h - 1])
for (let y = 0; y < h; y++) stack.push([0, y], [w - 1, y])
while (stack.length) {
  const [x, y] = stack.pop()
  if (x < 0 || y < 0 || x >= w || y >= h) continue
  const p = y * w + x
  if (seen[p]) continue
  const i = at(x, y)
  if (!isBg(i)) continue
  seen[p] = 1
  data[i + 3] = 0
  stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
}

// 透明な余白を切り詰めてから、正方形の中央に置き直す（呼び出し側で幅=高さで扱えるように）。
const cut = await sharp(data, { raw: { width: w, height: h, channels: ch } }).png().toBuffer()
const trimmed = await sharp(cut).trim().png().toBuffer()
const tm = await sharp(trimmed).metadata()
const side = Math.max(tm.width, tm.height)

// sharp は composite より resize を先に適用するため、正方形化と縮小は工程を分ける。
const squared = await sharp({
  create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([{ input: trimmed, gravity: 'center' }])
  .png()
  .toBuffer()

await sharp(squared)
  .resize(512, 512)
  .png({ compressionLevel: 9 })
  .toFile(resolve(publicDir, 'mascot.png'))

console.log('書き出しました: mascot.png (512x512, 背景透過)')

console.log(`完了: ${targets.length + 1}件 -> ${publicDir}`)
