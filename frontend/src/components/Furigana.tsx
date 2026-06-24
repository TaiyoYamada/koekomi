import type { ReactNode } from 'react'

// 「漢字(よみ)」という記法を <ruby>漢字<rt>よみ</rt></ruby> に変換して表示する。
//   例: <Ruby text="絵(え)を選(えら)ぶ" />  → 絵[え]を選[えら]ぶ
// 漢字以外（ひらがな・カタカナ・数字・記号・絵文字）はそのまま表示する。
const RUBY_RE = /([㐀-鿿々〆ヶ]+)\(([^)]+)\)/g

export function Ruby({ text }: { text: string }) {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  RUBY_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RUBY_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      <ruby key={key++}>
        {m[1]}
        <rt>{m[2]}</rt>
      </ruby>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}
