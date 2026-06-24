import { describe, expect, it } from 'vitest'
import { rankServers } from './registry'
import type { ServerInfo } from '../types'

function makeServer(over: Partial<ServerInfo>): ServerInfo {
  return {
    serverId: 'colab-x',
    color: 'blue',
    label: 'テスト',
    apiUrl: 'https://example.com',
    enabled: true,
    capacity: 2,
    assignedCount: 0,
    lastSeen: String(Date.now()),
    ...over,
  }
}

describe('rankServers', () => {
  it('enabled=false は除外する', () => {
    const list = rankServers([makeServer({ serverId: 'a', enabled: false })])
    expect(list).toHaveLength(0)
  })

  it('満員（assignedCount >= capacity）は除外する', () => {
    const list = rankServers([makeServer({ serverId: 'a', capacity: 2, assignedCount: 2 })])
    expect(list).toHaveLength(0)
  })

  it('lastSeen が古い（heartbeat 切れ）は除外する', () => {
    const old = String(Date.now() - 10 * 60 * 1000) // 10分前
    const list = rankServers([makeServer({ serverId: 'a', lastSeen: old })])
    expect(list).toHaveLength(0)
  })

  it('空き枠が多い順に並べる', () => {
    const list = rankServers([
      makeServer({ serverId: 'few', capacity: 2, assignedCount: 1 }), // 空き1
      makeServer({ serverId: 'many', capacity: 4, assignedCount: 0 }), // 空き4
      makeServer({ serverId: 'mid', capacity: 3, assignedCount: 1 }), // 空き2
    ])
    expect(list.map((s) => s.serverId)).toEqual(['many', 'mid', 'few'])
  })

  it('lastSeen は epoch 数値文字列でも ISO 文字列でも扱える', () => {
    const iso = new Date().toISOString()
    const list = rankServers([makeServer({ serverId: 'iso', lastSeen: iso })])
    expect(list).toHaveLength(1)
  })
})
