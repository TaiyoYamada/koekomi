import { usePanels } from '../hooks/usePanels'
import { Ruby } from './Furigana'

/** 20枚から1枚を選ぶオーバーレイ。 */
export function PanelPicker({
  selectedId,
  onPick,
  onClose,
}: {
  selectedId: string | null
  onPick: (panelId: string) => void
  onClose: () => void
}) {
  const { panels, loading } = usePanels()
  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-card" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <strong>
            <Ruby text="写真(しゃしん)を選(えら)ぶ" />
          </strong>
          <button className="btn secondary" onClick={onClose}>
            <Ruby text="閉(と)じる" />
          </button>
        </div>
        {loading ? (
          <div className="spinner" />
        ) : (
          <div className="panel-grid">
            {panels.map((p) => (
              <button
                key={p.id}
                className={'panel' + (p.id === selectedId ? ' selected' : '')}
                onClick={() => onPick(p.id)}
              >
                <img src={p.src} alt={p.label} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
