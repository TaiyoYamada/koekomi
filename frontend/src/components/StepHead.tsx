import type { ReactNode } from 'react'
import { Ruby } from './Furigana'

/** ステップの見出し（番号・タイトル・ヒント）。タイトルはふりがな記法で渡す。 */
export function StepHead({
  num,
  title,
  hint,
}: {
  num: number
  title: string
  hint?: ReactNode
}) {
  return (
    <>
      <div className="step-head">
        <div className="step-num">{num}</div>
        <h2 className="step-title">
          <Ruby text={title} />
        </h2>
      </div>
      {hint && <p className="step-hint">{hint}</p>}
    </>
  )
}
