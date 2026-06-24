import { Ruby } from './Furigana'
import { NAV } from '../ui/labels'

/** 画面下に固定する「もどる / つぎへ」ボタン。ラベルはふりがな記法。 */
export function NavBar({
  onBack,
  onNext,
  nextLabel = NAV.next,
  backLabel = NAV.back,
  nextDisabled,
  hideBack,
}: {
  onBack?: () => void
  onNext?: () => void
  nextLabel?: string
  backLabel?: string
  nextDisabled?: boolean
  hideBack?: boolean
}) {
  return (
    <div className="nav">
      {!hideBack && (
        <button className="btn secondary" onClick={onBack} disabled={!onBack}>
          <Ruby text={backLabel} />
        </button>
      )}
      {onNext && (
        <button className="btn" onClick={onNext} disabled={nextDisabled}>
          <Ruby text={nextLabel} />
        </button>
      )}
    </div>
  )
}
