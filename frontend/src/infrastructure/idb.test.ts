// IndexedDB の保管。**作品の音声の実体が置かれる場所**なので、
// モックではなく fake-indexeddb（本物と同じAPI）で往復させて確かめる。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAudio,
  deleteAudio,
  getAudio,
  listAudioKeys,
  putAudio,
  REFERENCE_KEY,
  TRYOUT_PREFIX,
} from './idb'

const wav = (bytes: number[] = [1, 2, 3, 4]) =>
  new Blob([new Uint8Array(bytes)], { type: 'audio/wav' })

async function bytesOf(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())]
}

beforeEach(async () => {
  await clearAudio()
})

describe('保存と取り出し', () => {
  it('入れたものがそのまま返る（中身も MIME も）', async () => {
    expect(await putAudio('l1', wav([9, 8, 7]))).toBe(true)

    const got = await getAudio('l1')
    expect(got).not.toBeNull()
    expect(await bytesOf(got!)).toEqual([9, 8, 7])
    expect(got!.type).toBe('audio/wav')
  })

  it('無いキーは null（呼び出し側を止めない）', async () => {
    expect(await getAudio('ない')).toBeNull()
  })

  it('同じキーに入れ直すと上書きされる（録り直し）', async () => {
    await putAudio('l1', wav([1]))
    await putAudio('l1', wav([2, 2]))
    expect(await bytesOf((await getAudio('l1'))!)).toEqual([2, 2])
  })

  it('空の Blob でも壊れない', async () => {
    await putAudio('empty', new Blob([]))
    const got = await getAudio('empty')
    expect(got).not.toBeNull()
    expect(got!.size).toBe(0)
  })

  it('MIME が無ければ既定値を付ける（<audio> が困らないように）', async () => {
    await putAudio('l1', new Blob([new Uint8Array([1])]))
    expect((await getAudio('l1'))!.type).toBe('application/octet-stream')
  })
})

describe('削除', () => {
  it('1件だけ消せる', async () => {
    await putAudio('l1', wav())
    await putAudio('l2', wav())
    await deleteAudio('l1')

    expect(await getAudio('l1')).toBeNull()
    expect(await getAudio('l2')).not.toBeNull()
  })

  it('全部消せる（次の子へ渡すとき）', async () => {
    await putAudio('l1', wav())
    await putAudio(REFERENCE_KEY, wav())
    await clearAudio()
    expect(await listAudioKeys()).toEqual([])
  })

  it('無いキーを消してもエラーにならない', async () => {
    await expect(deleteAudio('ない')).resolves.toBeUndefined()
  })
})

describe('キー一覧', () => {
  it('保存したキーが全部返る', async () => {
    await putAudio('l1', wav())
    await putAudio(REFERENCE_KEY, wav())
    await putAudio(`${TRYOUT_PREFIX}こんにちは`, wav())

    expect((await listAudioKeys()).sort()).toEqual(
      ['l1', REFERENCE_KEY, `${TRYOUT_PREFIX}こんにちは`].sort(),
    )
  })

  it('何も無ければ空配列', async () => {
    expect(await listAudioKeys()).toEqual([])
  })
})

describe('ストレージが使えない環境', () => {
  it('IndexedDB が開けなくても、アプリを落とさない', async () => {
    // プライベートモード等で open が失敗する状況を模す。
    const original = indexedDB.open
    vi.spyOn(indexedDB, 'open').mockImplementation(((...args: unknown[]) => {
      const req = original.apply(indexedDB, args as never) as IDBOpenDBRequest
      queueMicrotask(() => req.onerror?.(new Event('error') as never))
      return req
    }) as never)

    // 例外にせず、静かに失敗する（保存できなくても作業は続けられる）。
    await expect(getAudio('l1')).resolves.toBeNull()
    vi.restoreAllMocks()
  })
})
