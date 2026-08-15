// vitest 用の jest-dom（vitest の expect を自動で拡張する）
import '@testing-library/jest-dom/vitest'

// jsdom には IndexedDB が無い。作品の音声はそこに入るので、
// 実装を差し替えずに本物と同じ経路を通せるよう、偽の IndexedDB を入れる。
import 'fake-indexeddb/auto'

import { afterEach, beforeEach, vi } from 'vitest'

// jsdom の Blob には arrayBuffer() が無い（本物のブラウザにはある）。
// IndexedDB への保存で使っているので、FileReader で補う。
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}
if (typeof Blob !== 'undefined' && !Blob.prototype.text) {
  Blob.prototype.text = async function text(this: Blob): Promise<string> {
    return new TextDecoder().decode(await this.arrayBuffer())
  }
}

// object URL も jsdom には無い。中身は使わないので、識別できる文字列を返す。
let objectUrlSeq = 0
const objectUrls = new Map<string, Blob>()

if (!URL.createObjectURL) {
  Object.defineProperty(URL, 'createObjectURL', {
    writable: true,
    value: (blob: Blob) => {
      const url = `blob:koekomi/${++objectUrlSeq}`
      objectUrls.set(url, blob)
      return url
    },
  })
}
if (!URL.revokeObjectURL) {
  Object.defineProperty(URL, 'revokeObjectURL', {
    writable: true,
    value: (url: string) => {
      objectUrls.delete(url)
    },
  })
}

/** テストから「その object URL がまだ生きているか」を確かめるための覗き窓。 */
export function objectUrlExists(url: string): boolean {
  return objectUrls.has(url)
}

export function blobForObjectUrl(url: string): Blob | undefined {
  return objectUrls.get(url)
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
