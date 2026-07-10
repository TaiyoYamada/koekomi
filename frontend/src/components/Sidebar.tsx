import { useNavigate } from 'react-router-dom'
import { Ruby } from './Furigana'
import { Icon } from './icons'
import { Mascot } from './Mascot'
import { useApp } from '../state'
import type { SectionMeta } from '../ui/labels'

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
  const { setStarted } = useApp()
  return (
    <aside className="sidebar">
      {/* ロゴでスタート画面へ戻る（作品は保存されているので消えない）。 */}
      <button
        className="sidebar-brand"
        aria-label="スタート画面にもどる"
        onClick={() => {
          setStarted(false)
          navigate('/')
        }}
      >
        <span className="brand-mark">
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
        <button className="side-item small" onClick={() => navigate('/how-to')}>
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
        <button className="side-item small" onClick={() => navigate('/admin')}>
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
