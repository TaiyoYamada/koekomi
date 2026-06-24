import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  it('接続済みなら「あなたは ○サーバー です」を表示', () => {
    render(<ServerBadge assignment={assignment} mode="ai" />)
    expect(screen.getByText('あなたは 青サーバー です')).toBeInTheDocument()
  })

  it('未接続 + AIモードはさがし中を表示', () => {
    render(<ServerBadge assignment={null} mode="ai" />)
    expect(screen.getByText('サーバーをさがしています…')).toBeInTheDocument()
  })

  it('未接続 + フォールバックはオフライン表示', () => {
    render(<ServerBadge assignment={null} mode="browser-tts" />)
    expect(screen.getByText('オフラインモード')).toBeInTheDocument()
  })
})
