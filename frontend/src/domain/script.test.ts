import { describe, expect, it } from 'vitest'
import { REFERENCE_SCRIPT, REFERENCE_SCRIPT_LINES } from './script'

describe('REFERENCE_SCRIPT', () => {
  it('声クローンに十分な長さがある', () => {
    expect(REFERENCE_SCRIPT.length).toBeGreaterThan(40)
  })

  it('漢字を含まない（読み方に迷わせない）', () => {
    expect(REFERENCE_SCRIPT).not.toMatch(/[一-鿿]/)
  })

  it('可変部分（空欄）が無い（音声と文字が必ず一致するように）', () => {
    expect(REFERENCE_SCRIPT).not.toMatch(/[_＿[\]（(]/)
  })
})

describe('REFERENCE_SCRIPT_LINES', () => {
  it('「。」のうしろで改行して読みやすくする', () => {
    expect(REFERENCE_SCRIPT_LINES.length).toBeGreaterThan(1)
  })

  it('最後の断片以外は「。」で終わる', () => {
    for (const line of REFERENCE_SCRIPT_LINES.slice(0, -1)) {
      expect(line.endsWith('。')).toBe(true)
    }
  })

  it('つなげると元の文に戻る（送る参照テキストとズレない）', () => {
    expect(REFERENCE_SCRIPT_LINES.join('')).toBe(REFERENCE_SCRIPT)
  })

  it('空行が混ざらない', () => {
    expect(REFERENCE_SCRIPT_LINES.every((l) => l.trim() !== '')).toBe(true)
  })
})
