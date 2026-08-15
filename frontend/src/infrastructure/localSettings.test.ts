import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearAssignment,
  getDeviceId,
  loadAssignment,
  loadMode,
  saveAssignment,
  saveMode,
} from './localSettings'
import type { Assignment } from '../domain/types'

const assignment: Assignment = {
  serverId: 'colab-1',
  color: 'red',
  label: '赤サーバー',
  apiUrl: 'https://example.trycloudflare.com',
  assignedAt: 1_700_000_000_000,
  canRender: true,
}

beforeEach(() => {
  localStorage.clear()
})

describe('getDeviceId', () => {
  it('一度作ったら変わらない（つなぎ先が毎回変わらないため）', () => {
    const first = getDeviceId()
    expect(getDeviceId()).toBe(first)
  })

  it('空でない値を返す', () => {
    expect(getDeviceId().length).toBeGreaterThan(3)
  })
})

describe('assignment', () => {
  it('保存して読み戻せる', () => {
    saveAssignment(assignment)
    expect(loadAssignment()).toEqual(assignment)
  })

  it('保存が無ければ null', () => {
    expect(loadAssignment()).toBeNull()
  })

  it('壊れた JSON でも落ちない', () => {
    localStorage.setItem('koekomi.assignment', '{こわれてる')
    expect(loadAssignment()).toBeNull()
  })

  it('必須項目が欠けていたら無効として扱う', () => {
    localStorage.setItem('koekomi.assignment', JSON.stringify({ serverId: 'x' }))
    expect(loadAssignment()).toBeNull()
  })

  it('消せる', () => {
    saveAssignment(assignment)
    clearAssignment()
    expect(loadAssignment()).toBeNull()
  })
})

describe('mode', () => {
  it('既定は AI モード', () => {
    expect(loadMode()).toBe('ai')
  })

  it('保存して読み戻せる', () => {
    saveMode('self-record')
    expect(loadMode()).toBe('self-record')
  })

  it('知らない値は既定に戻す（壊れた保存で画面が出なくならないように）', () => {
    localStorage.setItem('koekomi.mode', 'なにこれ')
    expect(loadMode()).toBe('ai')
  })
})
