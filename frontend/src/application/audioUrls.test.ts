// AudioRef（ドメイン）→ 再生できるURL の解決。
//
// ここが「ドメインは IndexedDB のキーしか持たない」を成立させている層。
// object URL を作りっぱなしにするとメモリを食うので、解放も確かめる。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ensureAudioUrl,
  forgetAudio,
  peekAudioUrl,
  preloadAll,
  releaseAll,
  releaseAudioUrl,
  resolveAudioUrl,
  storeAudio,
} from './audioUrls'
import { clearAudio, getAudio, putAudio } from '../infrastructure/idb'
import { objectUrlExists } from '../test/setup'
import type { AudioRef } from '../domain/work'

const wav = (bytes: number[] = [1, 2, 3]) =>
  new Blob([new Uint8Array(bytes)], { type: 'audio/wav' })
const stored = (key: string): AudioRef => ({ kind: 'stored', key })

beforeEach(async () => {
  releaseAll()
  await clearAudio()
})

describe('storeAudio', () => {
  it('保存すると、すぐ再生できる URL が手に入る', async () => {
    await storeAudio('l1', wav())
    expect(peekAudioUrl(stored('l1'))).toMatch(/^blob:/)
    // 実体も残っている（リロード後に復元できる）。
    expect(await getAudio('l1')).not.toBeNull()
  })

  it('入れ直すと、古い URL は解放される（録り直し）', async () => {
    await storeAudio('l1', wav([1]))
    const first = peekAudioUrl(stored('l1'))!

    await storeAudio('l1', wav([2]))
    const second = peekAudioUrl(stored('l1'))!

    expect(second).not.toBe(first)
    expect(objectUrlExists(first)).toBe(false) // 漏らさない
    expect(objectUrlExists(second)).toBe(true)
  })
})

describe('ensureAudioUrl', () => {
  it('保存済みの音声を IndexedDB から読み戻せる（リロード後）', async () => {
    await putAudio('l1', wav()) // ストア経由でなく直接入れる＝リロード直後の状態
    expect(peekAudioUrl(stored('l1'))).toBeNull()

    const url = await ensureAudioUrl('l1')
    expect(url).toMatch(/^blob:/)
    expect(peekAudioUrl(stored('l1'))).toBe(url)
  })

  it('無い音声は null（再生側が「音声なし」として扱える）', async () => {
    expect(await ensureAudioUrl('ない')).toBeNull()
  })

  it('同時に何度呼んでも、読み込みは1回だけ（URLも1つ）', async () => {
    await putAudio('l1', wav())
    const urls = await Promise.all([
      ensureAudioUrl('l1'),
      ensureAudioUrl('l1'),
      ensureAudioUrl('l1'),
    ])
    expect(new Set(urls).size).toBe(1)
  })

  it('二度目は読み直さない（キャッシュが効く）', async () => {
    await putAudio('l1', wav())
    const first = await ensureAudioUrl('l1')
    const second = await ensureAudioUrl('l1')
    expect(second).toBe(first)
  })
})

describe('resolveAudioUrl', () => {
  it('音声なしの行は null', async () => {
    expect(await resolveAudioUrl({ kind: 'none' })).toBeNull()
  })

  it('保存済みの行は URL', async () => {
    await storeAudio('l1', wav())
    expect(await resolveAudioUrl(stored('l1'))).toMatch(/^blob:/)
  })
})

describe('解放', () => {
  it('releaseAudioUrl は URL だけ捨て、実体は残す', async () => {
    await storeAudio('l1', wav())
    const url = peekAudioUrl(stored('l1'))!

    releaseAudioUrl('l1')

    expect(objectUrlExists(url)).toBe(false)
    expect(peekAudioUrl(stored('l1'))).toBeNull()
    expect(await getAudio('l1')).not.toBeNull() // 実体は無事
    // もう一度読めば復活する。
    expect(await ensureAudioUrl('l1')).toMatch(/^blob:/)
  })

  it('forgetAudio は実体ごと消す', async () => {
    await storeAudio('l1', wav())
    const url = peekAudioUrl(stored('l1'))!

    await forgetAudio('l1')

    expect(objectUrlExists(url)).toBe(false)
    expect(await getAudio('l1')).toBeNull()
  })

  it('releaseAll は全部の URL を解放する（作品のリセット）', async () => {
    await storeAudio('l1', wav())
    await storeAudio('l2', wav())
    const urls = [peekAudioUrl(stored('l1'))!, peekAudioUrl(stored('l2'))!]

    releaseAll()

    for (const url of urls) expect(objectUrlExists(url)).toBe(false)
    expect(peekAudioUrl(stored('l1'))).toBeNull()
  })

  it('無いキーを解放しても壊れない', () => {
    expect(() => releaseAudioUrl('ない')).not.toThrow()
  })
})

describe('preloadAll', () => {
  it('再生前にまとめて読み込む（頭で音が出ない空白を作らない）', async () => {
    await putAudio('l1', wav())
    await putAudio('l2', wav())

    await preloadAll([stored('l1'), stored('l2'), { kind: 'none' }])

    expect(peekAudioUrl(stored('l1'))).toMatch(/^blob:/)
    expect(peekAudioUrl(stored('l2'))).toMatch(/^blob:/)
  })

  it('一部が読めなくても、他は読み込む', async () => {
    await putAudio('l1', wav())
    await preloadAll([stored('l1'), stored('ない')])
    expect(peekAudioUrl(stored('l1'))).toMatch(/^blob:/)
    expect(peekAudioUrl(stored('ない'))).toBeNull()
  })

  it('保存が壊れていても例外を投げない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(preloadAll([stored('a'), stored('b')])).resolves.toBeUndefined()
  })
})
