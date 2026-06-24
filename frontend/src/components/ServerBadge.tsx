import { colorDef } from '../lib/colors'
import type { Assignment, VoiceMode } from '../types'

/** 画面上部に「あなたは ○サーバー です」を表示する。 */
export function ServerBadge({ assignment, mode }: { assignment: Assignment | null; mode: VoiceMode }) {
  if (!assignment) {
    return (
      <div className="server-badge" style={{ background: '#e5e7eb', color: '#374151' }}>
        <span className="dot" style={{ background: '#9ca3af' }} />
        <span>{mode === 'ai' ? 'サーバーをさがしています…' : 'オフラインモード'}</span>
      </div>
    )
  }
  const c = colorDef(assignment.color)
  return (
    <div className="server-badge" style={{ background: c.hex, color: c.fg }}>
      <span className="dot" style={{ background: c.fg }} />
      <span>あなたは {c.jp}サーバー です</span>
    </div>
  )
}
