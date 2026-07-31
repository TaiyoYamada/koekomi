import type { ReactNode } from 'react'
import { Ruby } from './Furigana'

/** 画面の見出し（タイトル＋ヒント）。タイトルはふりがな記法で渡す。番号は付けない。
 *  action を渡すと、タイトルと同じ行の右側に置く（リセットボタンなど）。 */
export function StepHead({
  title,
  hint,
  action,
}: {
  title: string
  hint?: ReactNode
  action?: ReactNode
}) {
  return (
    <>
      <div className="step-head-row">
        <h2 className="step-title">
          <Ruby text={title} />
        </h2>
        {action}
      </div>
      {hint && <p className="step-hint">{hint}</p>}
    </>
  )
}
