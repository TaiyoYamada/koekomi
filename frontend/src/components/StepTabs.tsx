import { Ruby } from './Furigana'

export interface TabItem {
  label: string
  icon: string
}

/**
 * 画面上部のタブ。いつでも好きなステップへ行き来できる（順番は強制しない）。
 * iPad で押しやすいよう大きめ＆横スクロール対応。
 */
export function StepTabs({
  items,
  current,
  onPick,
}: {
  items: TabItem[]
  current: number
  onPick: (index: number) => void
}) {
  return (
    <nav className="step-tabs" aria-label="ステップ">
      {items.map((t, i) => (
        <button
          key={i}
          className={'step-tab' + (i === current ? ' active' : '')}
          onClick={() => onPick(i)}
          aria-current={i === current}
        >
          <span className="ic" aria-hidden>
            {t.icon}
          </span>
          <span className="lb">
            <Ruby text={t.label} />
          </span>
        </button>
      ))}
    </nav>
  )
}
