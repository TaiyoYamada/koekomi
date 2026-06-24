import { beforeEach, describe, expect, it } from 'vitest'
import { clearAssignment, loadAssignment, loadMode, saveAssignment, saveMode } from './storage'
import type { Assignment } from '../types'

const sample: Assignment = {
  serverId: 'colab-1',
  color: 'red',
  label: '赤サーバー',
  apiUrl: 'https://example.com',
  assignedAt: 1234567890,
}

describe('storage（接続先の保存）', () => {
  beforeEach(() => localStorage.clear())

  it('未保存なら null を返す', () => {
    expect(loadAssignment()).toBeNull()
  })

  it('保存した接続先を読み戻せる', () => {
    saveAssignment(sample)
    expect(loadAssignment()).toEqual(sample)
  })

  it('リセットすると消える', () => {
    saveAssignment(sample)
    clearAssignment()
    expect(loadAssignment()).toBeNull()
  })

  it('壊れた JSON は null として扱う', () => {
    localStorage.setItem('vct.assignment', '{ broken')
    expect(loadAssignment()).toBeNull()
  })

  it('apiUrl が無い不完全データは無効扱い', () => {
    localStorage.setItem('vct.assignment', JSON.stringify({ serverId: 'x' }))
    expect(loadAssignment()).toBeNull()
  })
})

describe('storage（モード）', () => {
  beforeEach(() => localStorage.clear())

  it('既定は ai モード', () => {
    expect(loadMode()).toBe('ai')
  })

  it('モードを保存・復元できる', () => {
    saveMode('browser-tts')
    expect(loadMode()).toBe('browser-tts')
  })

  it('不正な値は ai にフォールバック', () => {
    localStorage.setItem('vct.mode', 'nonsense')
    expect(loadMode()).toBe('ai')
  })
})
