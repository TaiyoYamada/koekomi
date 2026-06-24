import { StepHead } from '../components/StepHead'
import { NavBar } from '../components/NavBar'
import { findPanel, usePanels } from '../hooks/usePanels'
import { useApp } from '../state'
import type { StepProps } from './types'

/** ステップ: セリフを書く（4コマ分）。 */
export function WriteLines({ stepNumber, goNext, goBack }: StepProps) {
  const { panels } = usePanels()
  const { selectedPanels, lines, setLine } = useApp()

  // 少なくとも1つは書いてあれば次へ進める（全部必須にすると詰まりやすい）。
  const canNext = lines.some((l) => l.trim().length > 0)

  return (
    <div>
      <StepHead num={stepNumber} title="セリフを書く" hint="コマごとに しゃべる ことばを 書いてね" />
      {selectedPanels.map((pid, i) => {
        const panel = findPanel(panels, pid)
        return (
          <div className="line-row" key={pid}>
            {panel && <img src={panel.src} alt={panel.label} />}
            <div style={{ flex: 1 }}>
              <div className="coma-no">{i + 1}コマめ</div>
              <input
                type="text"
                value={lines[i]}
                maxLength={60}
                placeholder="ここに ことばを 書く"
                onChange={(e) => setLine(i, e.target.value)}
              />
            </div>
          </div>
        )
      })}
      <NavBar
        onBack={goBack}
        onNext={goNext}
        nextDisabled={!canNext}
        nextLabel="声をろくおん →"
      />
    </div>
  )
}
