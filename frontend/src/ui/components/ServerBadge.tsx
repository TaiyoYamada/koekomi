import { Ruby } from './Furigana'
import type { ConnectionState } from '../../application/connection'
import type { VoiceMode } from '../../domain/types'

/**
 * 画面上部の接続ステータス。
 *
 * 正常につながっているときは何も出さない（子どもに見せる情報を減らすため）。
 * どのColabにつながっているかは、サイドバーのロゴマークの色で確認できる。
 * 異常時（接続中・未接続・オフライン）だけは、気づけるように必ず表示する。
 */
export function ServerBadge({
  connection,
  mode,
}: {
  connection: ConnectionState
  mode: VoiceMode
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
  if (connection.status === 'connected' && connection.assignment) return null
  if (connection.status === 'connecting' || connection.status === 'idle') {
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
