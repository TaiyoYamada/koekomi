import { describe, expect, it } from 'vitest'
import { hashString, lastSeenMs, liveServers, preferEmptier, tryOrder } from './connection'
import type { HealthInfo } from '../infrastructure/apiClient'
import type { ServerInfo } from '../domain/types'

function server(id: string, patch: Partial<ServerInfo> = {}): ServerInfo {
  return {
    serverId: id,
    color: 'red',
    label: id,
    apiUrl: `https://${id}.example.com`,
    enabled: true,
    lastSeen: String(Date.now()),
    ...patch,
  }
}

describe('lastSeenMs', () => {
  it('epoch文字列とISO文字列の両方を読む', () => {
    const now = Date.now()
    expect(lastSeenMs(String(now))).toBe(now)
    expect(lastSeenMs(new Date(now).toISOString())).toBe(
      new Date(now).setMilliseconds(new Date(now).getMilliseconds()),
    )
  })

  it('読めない値は0（＝古いとみなす）', () => {
    expect(lastSeenMs('')).toBe(0)
    expect(lastSeenMs('なんだこれ')).toBe(0)
  })
})

describe('liveServers', () => {
  it('無効な台とURLの無い台を外す', () => {
    const list = liveServers([
      server('a'),
      server('b', { enabled: false }),
      server('c', { apiUrl: '' }),
    ])
    expect(list.map((s) => s.serverId)).toEqual(['a'])
  })

  it('heartbeat が古い台を外す', () => {
    const old = String(Date.now() - 60 * 60 * 1000)
    const list = liveServers([server('a'), server('b', { lastSeen: old })])
    expect(list.map((s) => s.serverId)).toEqual(['a'])
  })

  it('serverId 順に安定して並ぶ（並びが実行ごとに揺れない）', () => {
    const list = liveServers([server('c'), server('a'), server('b')])
    expect(list.map((s) => s.serverId)).toEqual(['a', 'b', 'c'])
  })
})

describe('tryOrder', () => {
  const three = [server('colab-1'), server('colab-2'), server('colab-3')]

  it('全台を1回ずつ回る（どれかが死んでも最後まで試せる）', () => {
    const order = tryOrder(three, 'device-1')
    expect(order).toHaveLength(3)
    expect(new Set(order.map((s) => s.serverId)).size).toBe(3)
  })

  it('同じ端末はいつも同じ台から始める（毎回つなぎ先が変わらない）', () => {
    const a = tryOrder(three, 'device-1').map((s) => s.serverId)
    const b = tryOrder(three, 'device-1').map((s) => s.serverId)
    expect(a).toEqual(b)
  })

  it('端末ごとに開始位置が散る（全員が1台目に殺到しない）', () => {
    // 以前は全端末が同じ並びの先頭を掴んでいた。ここが本質的な修正点。
    const starts = new Set<string>()
    for (let i = 0; i < 30; i++) starts.add(tryOrder(three, `device-${i}`)[0].serverId)
    expect(starts.size).toBeGreaterThan(1)
  })

  it('30台ぶん配ると3台に概ね均等に散る', () => {
    const counts = new Map<string, number>()
    for (let i = 0; i < 300; i++) {
      const first = tryOrder(three, `ipad-${i}`)[0].serverId
      counts.set(first, (counts.get(first) ?? 0) + 1)
    }
    for (const n of counts.values()) {
      // 完全均等は 100。極端な偏りが無いことだけ確認する。
      expect(n).toBeGreaterThan(50)
      expect(n).toBeLessThan(160)
    }
  })

  it('除外した台は候補に入らない（フェイルオーバー）', () => {
    const order = tryOrder(three, 'device-1', 'colab-2')
    expect(order.map((s) => s.serverId)).not.toContain('colab-2')
    expect(order).toHaveLength(2)
  })

  it('候補が無ければ空（呼び出し側がフォールバックへ落とす）', () => {
    expect(tryOrder([], 'device-1')).toEqual([])
    expect(tryOrder([server('only')], 'device-1', 'only')).toEqual([])
  })
})

describe('hashString', () => {
  it('決定的で非負', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).toBeGreaterThanOrEqual(0)
  })

  it('違う入力は概ね違う値になる', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 200; i++) seen.add(hashString(`d-${i}`))
    expect(seen.size).toBeGreaterThan(190)
  })
})

describe('preferEmptier', () => {
  const health = (voicesEnrolled: number) => ({ voicesEnrolled }) as HealthInfo
  const candidate = (id: string, n: number) => ({ server: server(id), health: health(n) })

  it('人数の少ない台を先に置く', () => {
    const sorted = preferEmptier([candidate('a', 3), candidate('b', 0), candidate('c', 1)])
    expect(sorted.map((c) => c.server.serverId)).toEqual(['b', 'c', 'a'])
  })

  it('同数なら渡された順（＝ハッシュ順）のまま', () => {
    // ここが本質。授業開始の合図では全台 0 人で横並びになる。
    // 人数で決め打つと全員が同じ台に殺到する（ADR 0001 の壊れ方）。
    const sorted = preferEmptier([candidate('c', 0), candidate('a', 0), candidate('b', 0)])
    expect(sorted.map((c) => c.server.serverId)).toEqual(['c', 'a', 'b'])
  })

  it('全台0人のとき、端末ごとの散らばりが tryOrder のまま保たれる', () => {
    const six = ['colab-1', 'colab-2', 'colab-3', 'colab-4', 'colab-5', 'colab-6'].map((id) =>
      server(id),
    )
    for (let i = 0; i < 50; i++) {
      const order = tryOrder(six, `ipad-${i}`)
      const picked = preferEmptier(order.map((s) => ({ server: s, health: health(0) })))[0]
      expect(picked.server.serverId).toBe(order[0].serverId)
    }
  })

  it('人数が無いサーバー（古い版）は0人として扱う', () => {
    const legacy = { server: server('old'), health: {} as HealthInfo }
    const sorted = preferEmptier([candidate('a', 2), legacy])
    expect(sorted.map((c) => c.server.serverId)).toEqual(['old', 'a'])
  })
})
