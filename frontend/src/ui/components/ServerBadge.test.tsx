import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ServerBadge } from './ServerBadge'
import type { ConnectionState } from '../../application/connection'
import type { Assignment } from '../../domain/types'

const assignment: Assignment = {
  serverId: 'colab-1',
  color: 'red',
  label: '赤サーバー',
  apiUrl: 'https://example.com',
  assignedAt: Date.now(),
  canRender: true,
}

const state = (patch: Partial<ConnectionState> = {}): ConnectionState => ({
  status: 'connected',
  assignment,
  error: null,
  ...patch,
})

describe('ServerBadge', () => {
  it('つながっているときは何も出さない（子どもに見せる情報を減らす）', () => {
    const { container } = render(<ServerBadge connection={state()} mode="ai" />)
    expect(container.firstChild).toBeNull()
  })

  it('接続中は「接続中」と出す', () => {
    // ふりがな（<ruby>）で文字が分割されるので、まとめた textContent で見る。
    const { container } = render(
      <ServerBadge connection={state({ status: 'connecting', assignment: null })} mode="ai" />,
    )
    expect(container.textContent).toContain('接続中')
  })

  it('失敗したら気づけるように必ず出す', () => {
    const { container } = render(
      <ServerBadge
        connection={state({ status: 'failed', assignment: null, error: 'だめ' })}
        mode="ai"
      />,
    )
    expect(container.textContent).toContain('されていません')
  })

  it('フォールバックモードはオフラインと表示する', () => {
    render(<ServerBadge connection={state()} mode="self-record" />)
    expect(screen.getByText('オフラインモード')).toBeTruthy()
  })
})
