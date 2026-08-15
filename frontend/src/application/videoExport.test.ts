import { describe, expect, it } from 'vitest'
import { exportFileName } from './videoExport'

describe('exportFileName', () => {
  it('タイトルをファイル名に使う', () => {
    expect(exportFileName('ぼくの4コマ', 'mp4')).toBe('ぼくの4コマ.mp4')
  })

  it('タイトルが無ければ既定名', () => {
    expect(exportFileName('', 'mp4')).toBe('koekomi-4koma.mp4')
    expect(exportFileName('   ', 'webm')).toBe('koekomi-4koma.webm')
  })

  it('ファイル名に使えない文字を落とす（子どもが何を書いても保存できるように）', () => {
    expect(exportFileName('a/b\\c:d*e?f"g<h>i|j', 'mp4')).toBe('abcdefghij.mp4')
  })

  it('記号だけのタイトルは既定名に戻す', () => {
    expect(exportFileName('///', 'mp4')).toBe('koekomi-4koma.mp4')
  })
})
