import { useNavigate } from 'react-router-dom'
import { Ruby } from './Furigana'
import { Icon } from './icons'
import { Mascot } from './Mascot'
import { useConnection } from '../../application/connection'
import { useMode, workActions } from '../../application/workStore'
import { colorDef } from '../colors'
import type { SectionMeta } from '../sections'

/** 左サイドバー。どの画面へもいつでも移動できる（順番なし）。 */
export function Sidebar({
  items,
  active,
  onSelect,
}: {
  items: SectionMeta[]
  active: string
  onSelect: (key: string) => void
}) {
  const navigate = useNavigate()
  const { assignment } = useConnection()
  const mode = useMode()

  // どのColabにつながっているかは、ロゴマークの地色で示す（接続ステータスの
  // バッジは正常時に出さないため、ここが唯一の確認手段になる）。
  const server = mode === 'ai' && assignment ? colorDef(assignment.color) : null

  return (
    <aside className="sidebar">
      {/* ロゴでスタート画面へ戻る（作品は保存されているので消えない）。 */}
      <button
        className="sidebar-brand"
        aria-label="スタート画面にもどる"
        onClick={() => {
          workActions.setStarted(false)
          navigate('/')
        }}
      >
        <span
          className={'brand-mark' + (server ? ' server' : '')}
          style={server ? { background: server.hex } : undefined}
          // 色だけに頼らず、先生・TAが文字でも確認できるようにしておく。
          title={server ? `${server.jp}サーバーに接続中` : undefined}
        >
          <Mascot size={32} />
        </span>
        <span className="brand-name">コエコミ</span>
      </button>
      <nav className="sidebar-nav">
        {items.map((it) => (
          <button
            key={it.key}
            className={'side-item' + (active === it.key ? ' active' : '')}
            onClick={() => onSelect(it.key)}
            aria-current={active === it.key}
            // ふりがなを二重に読み上げさせない（<ruby> のまま読むと
            // 「録音 ろくおん」になる）。
            aria-label={it.name}
          >
            <span className="ic">
              <Icon name={it.icon} size={24} />
            </span>
            <span className="lb">
              <Ruby text={it.label} />
            </span>
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <button className="side-item small" aria-label="遊び方" onClick={() => navigate('/how-to')}>
          <span className="ic">
            <Icon name="play" size={20} />
          </span>
          <span className="lb">
            <Ruby text="遊(あそ)び方(かた)" />
          </span>
        </button>
        <button className="side-item small" onClick={() => navigate('/privacy')}>
          <span className="ic">
            <Icon name="lock" size={20} />
          </span>
          <span className="lb">プライバシー</span>
        </button>
        <button className="side-item small" aria-label="設定" onClick={() => navigate('/admin')}>
          <span className="ic">
            <Icon name="settings" size={20} />
          </span>
          <span className="lb">
            <Ruby text="設定(せってい)" />
          </span>
        </button>
      </div>
    </aside>
  )
}
