// コエコミのマスコット（しゃべる吹き出しキャラ）。教育系キッズアプリ定番の
// 「キャラが語りかける」演出のための簡易キャラクター。
//
// 画像はアプリアイコンと同じ1枚のマスターから書き出している（npm run icons）。
// アイコンとアプリ内のキャラを必ず同じ絵柄に保つため、ここでSVGを描き起こさない。

export function Mascot({ size = 132 }: { size?: number }) {
  return (
    <img
      className="mascot"
      src="/mascot.png"
      width={size}
      height={size}
      alt="コエコミのキャラクター"
      // 縮小時にぼやけないよう、拡大表示はしない前提で高品質補間に任せる。
      style={{ display: 'block', objectFit: 'contain' }}
      draggable={false}
    />
  )
}
