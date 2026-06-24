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

describe('ServerBadge', () => {
  // ふりがな（<ruby>）でテキストが分割されるため textContent で確認する。
  it('接続済みなら「あなたは ○サーバー です」を表示（漢字＋ふりがな）', () => {
    const { container } = render(<ServerBadge assignment={assignment} mode="ai" />)
    const text = container.textContent ?? ''
    expect(text).toContain('あなたは')
    expect(text).toContain('青') // 漢字
    expect(text).toContain('あお') // ふりがな
    expect(text).toContain('サーバー')
  })

  it('未接続 + AIモードはさがし中を表示', () => {
    const { container } = render(<ServerBadge assignment={null} mode="ai" />)
    expect(container.textContent ?? '').toContain('探')
  })

  it('未接続 + フォールバックはオフライン表示', () => {
    const { container } = render(<ServerBadge assignment={null} mode="browser-tts" />)
    expect(container.textContent ?? '').toContain('オフラインモード')
  })
})
