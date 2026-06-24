// 20枚のダミーパネル画像（SVG）と manifest.json を生成する。
//
// 本番では public/panels/ の SVG を実画像（png/jpg/svg）に差し替え、
// manifest.json の src と label を更新するだけで入れ替えられる。
//
//   実行: npm run panels   (または node frontend/scripts/generate-panels.mjs)

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(__dirname, '../public/panels')
mkdirSync(outDir, { recursive: true })

// 見た目を変えるためのパレットと、わかりやすい絵文字＋ことば。
const palette = [
  '#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff',
  '#a0c4ff', '#bdb2ff', '#ffc6ff', '#fffffc', '#f1c0e8',
  '#cfbaf0', '#a3c4f3', '#90dbf4', '#8eecf5', '#98f5e1',
  '#b9fbc0', '#ffcfd2', '#f7d6e0', '#fde4cf', '#d0f4de',
]
const motifs = [
  ['🐶', 'いぬ'], ['🐱', 'ねこ'], ['🐰', 'うさぎ'], ['🐻', 'くま'],
  ['🦊', 'きつね'], ['🐸', 'かえる'], ['🐧', 'ペンギン'], ['🦁', 'ライオン'],
  ['🐢', 'かめ'], ['🐥', 'ひよこ'], ['🌳', 'き'], ['🏠', 'いえ'],
  ['🚀', 'ロケット'], ['⭐', 'ほし'], ['🌈', 'にじ'], ['🍎', 'りんご'],
  ['🎈', 'ふうせん'], ['🚗', 'くるま'], ['⚽', 'ボール'], ['🎁', 'プレゼント'],
]

const manifest = []
for (let i = 0; i < 20; i++) {
  const n = String(i + 1).padStart(2, '0')
  const bg = palette[i % palette.length]
  const [emoji, word] = motifs[i % motifs.length]
  const id = `panel-${n}`
  const file = `${id}.svg`
  const label = `${word}`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <rect width="400" height="400" fill="${bg}"/>
  <rect x="8" y="8" width="384" height="384" rx="24" fill="none" stroke="#33333322" stroke-width="4"/>
  <text x="200" y="210" font-size="180" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
  <text x="200" y="350" font-size="44" text-anchor="middle" fill="#333" font-family="sans-serif">${label}</text>
</svg>
`
  writeFileSync(resolve(outDir, file), svg, 'utf8')
  manifest.push({ id, src: `/panels/${file}`, label })
}

writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
console.log(`生成しました: ${manifest.length}枚 + manifest.json -> ${outDir}`)
