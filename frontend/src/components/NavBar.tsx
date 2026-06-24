/** 画面下に固定する「もどる / つぎへ」ボタン。 */
export function NavBar({
  onBack,
  onNext,
  nextLabel = 'つぎへ →',
  backLabel = '← もどる',
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
          {backLabel}
        </button>
      )}
      {onNext && (
        <button className="btn" onClick={onNext} disabled={nextDisabled}>
          {nextLabel}
        </button>
      )}
    </div>
  )
}
