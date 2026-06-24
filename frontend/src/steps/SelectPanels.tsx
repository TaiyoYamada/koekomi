import { StepHead } from '../components/StepHead'
import { NavBar } from '../components/NavBar'
import { Ruby } from '../components/Furigana'
import { NEXT } from '../ui/labels'
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
        title="絵(え)を選(えら)ぶ"
        hint={<Ruby text={`すきな絵(え)を4枚(まい)選(えら)んでね（${selectedPanels.length}/4）`} />}
      />
      {error && (
        <div className="banner err">
          <Ruby text="絵(え)が読(よ)みこめませんでした：" />
          {error}
        </div>
      )}
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
        nextLabel={NEXT.toLines}
      />
    </div>
  )
}
