import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ServerBadge } from './ServerBadge'
import type { Assignment } from '../types'

const assignment: Assignment = {
  serverId: 'colab-2',
  color: 'blue',
  label: '青サーバー',
  apiUrl: 'https://example.com',
  assignedAt: 0,
}

describe('ServerBadge（接続ステータス）', () => {
  it('接続済みなら何も表示しない（サーバー色はサイドバーのロゴが示す）', () => {
    const { container } = render(<ServerBadge assignment={assignment} mode="ai" />)
    expect(container.textContent).toBe('')
    expect(container.querySelector('.status-pill')).toBeNull()
  })

  it('未接続なら「接続されていません」を表示', () => {
    // ふりがな（ruby）で漢字の間に読みが入るため、断片ごとに確認する。
    const { container } = render(<ServerBadge assignment={null} mode="ai" connecting={false} />)
    const text = container.textContent ?? ''
    expect(text).toContain('接続')
    expect(text).toContain('されていません')
  })

  it('接続中は「接続中」を表示', () => {
    const { container } = render(<ServerBadge assignment={null} mode="ai" connecting />)
    const text = container.textContent ?? ''
    expect(text).toContain('接続')
    expect(text).toContain('中')
  })

  it('フォールバックはオフライン表示', () => {
    const { container } = render(<ServerBadge assignment={null} mode="browser-tts" />)
    expect(container.textContent ?? '').toContain('オフラインモード')
  })
})
