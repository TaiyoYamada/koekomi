import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Ruby } from './Furigana'

describe('Ruby（ふりがな）', () => {
  it('漢字(よみ) を <ruby>/<rt> に変換する', () => {
    const { container } = render(<Ruby text="絵(え)を選(えら)ぶ" />)
    const rubies = container.querySelectorAll('ruby')
    expect(rubies).toHaveLength(2)
    const rts = Array.from(container.querySelectorAll('rt')).map((n) => n.textContent)
    expect(rts).toEqual(['え', 'えら'])
    // 表示テキストは「絵え を 選えら ぶ」のように連結される
    expect(container.textContent).toBe('絵えを選えらぶ')
  })

  it('ふりがな記法が無い文字（かな・数字・記号）はそのまま', () => {
    const { container } = render(<Ruby text="4コマ目（1/4）" />)
    expect(container.querySelectorAll('ruby')).toHaveLength(0)
    expect(container.textContent).toBe('4コマ目（1/4）')
  })
})
