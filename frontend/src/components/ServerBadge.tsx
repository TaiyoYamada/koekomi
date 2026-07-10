import { colorDef } from '../lib/colors'
import { Ruby } from './Furigana'
import type { Assignment, VoiceMode } from '../types'

/**
 * 画面上部の接続ステータス。
 * 「あなたは○サーバーです」のような表現はやめ、シンプルな接続状態を表示する。
 * 接続済みのときだけ、どのColabかを色ドットで示す（色は維持）。
 */
export function ServerBadge({
  assignment,
  mode,
  connecting,
}: {
  assignment: Assignment | null
  mode: VoiceMode
  connecting?: boolean
}) {
  if (mode !== 'ai') {
    return (
      <div className="status-pill muted">
        <span className="status-dot" />
        <span>オフラインモード</span>
      </div>
    )
  }
  if (assignment) {
    const c = colorDef(assignment.color)
    return (
      <div className="status-pill ok">
        <span className="status-dot" style={{ background: c.hex }} />
        <span>
          <Ruby text="接続済(せつぞくず)み" />
        </span>
      </div>
    )
  }
  if (connecting) {
    return (
      <div className="status-pill">
        <span className="status-dot pulsing" />
        <span>
          <Ruby text="サーバーに接続中(せつぞくちゅう)…" />
        </span>
      </div>
    )
  }
  return (
    <div className="status-pill warn">
      <span className="status-dot" />
      <span>
        <Ruby text="サーバーに接続(せつぞく)されていません" />
      </span>
    </div>
  )
}
