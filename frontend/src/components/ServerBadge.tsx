import { Ruby } from './Furigana'
import type { Assignment, VoiceMode } from '../types'

/**
 * 画面上部の接続ステータス。
 * 「あなたは○サーバーです」のような表現はやめ、シンプルな接続状態を表示する。
 *
 * 正常につながっているときは何も出さない（子どもに見せる情報を減らすため）。
 * どのColabにつながっているかは、サイドバーのロゴマークの色で確認できる。
 * 異常時（接続中・未接続・オフライン）だけは、気づけるように必ず表示する。
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
  // 接続済みは何も表示しない（サーバーの色はサイドバーのロゴマークが示す）。
  if (assignment) return null
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
