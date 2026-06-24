import { StepHead } from '../components/StepHead'
import { NavBar } from '../components/NavBar'
import { usePanels } from '../hooks/usePanels'
import { useApp } from '../state'
import type { StepProps } from './types'

/** ステップ: えをえらぶ（20枚から4枚, 順番つき）。 */
export function SelectPanels({ stepNumber, goNext, goBack, isFirst }: StepProps) {
  const { panels, loading, error } = usePanels()
  const { selectedPanels, setSelectedPanels } = useApp()

  function toggle(id: string) {
    const idx = selectedPanels.indexOf(id)
    if (idx >= 0) {
      // 選び直し: 外す
      setSelectedPanels(selectedPanels.filter((p) => p !== id))
    } else if (selectedPanels.length < 4) {
      setSelectedPanels([...selectedPanels, id])
    }
  }

  return (
    <div>
      <StepHead
        num={stepNumber}
        title="えをえらぶ"
        hint={`すきな えを 4まい えらんでね（${selectedPanels.length}/4）`}
      />
      {error && <div className="banner err">えが よみこめませんでした: {error}</div>}
      {loading ? (
        <div className="spinner" />
      ) : (
        <div className="panel-grid">
          {panels.map((p) => {
            const order = selectedPanels.indexOf(p.id)
            return (
              <button
                key={p.id}
                className={'panel' + (order >= 0 ? ' selected' : '')}
                onClick={() => toggle(p.id)}
              >
                <img src={p.src} alt={p.label} />
                {order >= 0 && <span className="pick-order">{order + 1}</span>}
              </button>
            )
          })}
        </div>
      )}
      <NavBar
        onBack={goBack}
        hideBack={isFirst}
        onNext={goNext}
        nextDisabled={selectedPanels.length !== 4}
        nextLabel="セリフを書く →"
      />
    </div>
  )
}
