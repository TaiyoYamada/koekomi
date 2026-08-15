// アクセシビリティの自動検査。
//
// 小学校には支援技術を使う子もいる。「見えている人には動く」だけでは足りない。
// axe で機械的に検査し、加えて **このアプリで特に大事な2点**を明示的に守る:
//
//   1. 待ち順位・進み具合が読み上げられる（画面を見ていなくても進行が分かる）
//   2. 状態を色だけで伝えない（サーバーの色、録音中の赤など）

import { render } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ServerBadge } from './components/ServerBadge'
import { Ruby } from './components/Furigana'
import { StepHead } from './components/StepHead'
import { PanelPicker } from './components/PanelPicker'
import type { ConnectionState } from '../application/connection'
import type { Assignment } from '../domain/types'

const assignment: Assignment = {
  serverId: 'colab-1',
  color: 'red',
  label: '赤サーバー',
  apiUrl: 'https://example.com',
  assignedAt: 0,
  canRender: true,
}

const connection = (patch: Partial<ConnectionState> = {}): ConnectionState => ({
  status: 'connected',
  assignment,
  error: null,
  ...patch,
})

/** vitest-axe の結果に違反が無いこと。
 *
 * color-contrast は無効にしている。jsdom は実際に描画しないので
 * 色の対比を測れず（canvas が無い）、常に不確定になるため。
 * コントラストは実ブラウザ（Playwright / Lighthouse）で見るべき項目。
 */
async function expectNoViolations(container: HTMLElement) {
  const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } })
  const violations = results.violations ?? []
  expect(
    violations.map((v) => `${v.id}: ${v.description}`),
    JSON.stringify(violations, null, 1),
  ).toEqual([])
}

describe('axe による自動検査', () => {
  it('ふりがなの表示に違反が無い', async () => {
    const { container } = render(<Ruby text="編集(へんしゅう)する" />)
    await expectNoViolations(container)
  })

  it('見出しに違反が無い', async () => {
    const { container } = render(
      <StepHead title="編集(へんしゅう)" hint={<Ruby text="写真(しゃしん)を選(えら)ぶ" />} />,
    )
    await expectNoViolations(container)
  })

  it('接続ステータスに違反が無い', async () => {
    const { container } = render(
      <ServerBadge connection={connection({ status: 'failed', assignment: null })} mode="ai" />,
    )
    await expectNoViolations(container)
  })

  it('写真選びのオーバーレイに違反が無い（画像に代替テキストがある）', async () => {
    const { container } = render(
      <MemoryRouter>
        <PanelPicker selectedId={null} onPick={() => {}} onClose={() => {}} />
      </MemoryRouter>,
    )
    await expectNoViolations(container)
  })
})

describe('進行状況が読み上げられる', () => {
  it('接続中は読み上げ対象になっている', () => {
    const { container } = render(
      <ServerBadge connection={connection({ status: 'connecting', assignment: null })} mode="ai" />,
    )
    const live = container.querySelector('[role="status"], [aria-live]')
    expect(live).not.toBeNull()
  })

  it('接続失敗は alert として伝える（見逃されないように）', () => {
    const { container } = render(
      <ServerBadge connection={connection({ status: 'failed', assignment: null })} mode="ai" />,
    )
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
  })
})

describe('色だけに頼らない', () => {
  it('オフラインモードは文字でも分かる', () => {
    const { container } = render(<ServerBadge connection={connection()} mode="self-record" />)
    expect(container.textContent).toContain('オフライン')
  })

  it('未接続は文字でも分かる', () => {
    const { container } = render(
      <ServerBadge connection={connection({ status: 'failed', assignment: null })} mode="ai" />,
    )
    expect(container.textContent).toContain('されていません')
  })
})
