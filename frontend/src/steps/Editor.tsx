import { useState } from 'react'
import { StepHead } from '../components/StepHead'
import { Ruby } from '../components/Furigana'
import { Icon } from '../components/icons'
import { PanelPicker } from '../components/PanelPicker'
import { findPanel, usePanels } from '../hooks/usePanels'
import { useApp } from '../state'
import { MAX_LINES_PER_COMA } from '../types'

/** 編集画面：4コマを縦に並べ、各コマで「写真＋セリフ（追加/編集/削除/並べ替え）」を編集する。 */
export function Editor() {
  const { panels } = usePanels()
  const { comas, setComaPanel, moveComa, addLine, updateLine, deleteLine, moveLine } = useApp()
  const [pickerFor, setPickerFor] = useState<number | null>(null)

  return (
    <div>
      <StepHead
        title="編集(へんしゅう)"
        hint={<Ruby text="写真(しゃしん)を選(えら)んで、セリフを書(か)こう。順番(じゅんばん)も変(か)えられるよ。" />}
      />

      {comas.map((coma, ci) => {
        const panel = findPanel(panels, coma.panelId)
        return (
          <div className="coma-card" key={ci}>
            <div className="coma-card-head">
              <span className="coma-label">
                <Ruby text={`${ci + 1}枚目(まいめ)`} />
              </span>
              <div className="reorder">
                <button className="mini" onClick={() => moveComa(ci, -1)} disabled={ci === 0} aria-label="コマを上へ">
                  ▲
                </button>
                <button
                  className="mini"
                  onClick={() => moveComa(ci, 1)}
                  disabled={ci === comas.length - 1}
                  aria-label="コマを下へ"
                >
                  ▼
                </button>
              </div>
            </div>

            <button className="coma-photo" onClick={() => setPickerFor(ci)}>
              {panel ? (
                <img src={panel.src} alt={panel.label} />
              ) : (
                <span className="coma-photo-empty">
                  <Ruby text="写真(しゃしん)を選(えら)ぶ" />
                </span>
              )}
            </button>

            <div className="lines">
              {coma.lines.map((line, li) => (
                <div className="line-edit" key={line.id}>
                  <div className="reorder">
                    <button
                      className="mini"
                      onClick={() => moveLine(ci, line.id, -1)}
                      disabled={li === 0}
                      aria-label="セリフを上へ"
                    >
                      ▲
                    </button>
                    <button
                      className="mini"
                      onClick={() => moveLine(ci, line.id, 1)}
                      disabled={li === coma.lines.length - 1}
                      aria-label="セリフを下へ"
                    >
                      ▼
                    </button>
                  </div>
                  <input
                    type="text"
                    value={line.text}
                    maxLength={60}
                    placeholder="ここに言葉を書く"
                    onChange={(e) => updateLine(ci, line.id, e.target.value)}
                  />
                  <button
                    className="mini del"
                    onClick={() => deleteLine(ci, line.id)}
                    aria-label="セリフを消す"
                  >
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              ))}

              <button
                className="btn secondary add-line"
                onClick={() => addLine(ci)}
                disabled={coma.lines.length >= MAX_LINES_PER_COMA}
              >
                <Ruby
                  text={
                    coma.lines.length >= MAX_LINES_PER_COMA
                      ? 'セリフは4つまで'
                      : '＋ セリフを増(ふ)やす'
                  }
                />
              </button>
            </div>
          </div>
        )
      })}

      {pickerFor !== null && (
        <PanelPicker
          selectedId={comas[pickerFor].panelId}
          onPick={(id) => {
            setComaPanel(pickerFor, id)
            setPickerFor(null)
          }}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  )
}
