import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Ruby } from './Furigana'

describe('Ruby', () => {
  it('漢字(よみ) を ruby 要素にする', () => {
    const { container } = render(<Ruby text="編集(へんしゅう)する" />)
    const ruby = container.querySelector('ruby')
    expect(ruby).not.toBeNull()
    expect(ruby?.textContent).toBe('編集へんしゅう')
    expect(container.querySelector('rt')?.textContent).toBe('へんしゅう')
    expect(container.textContent).toBe('編集へんしゅうする')
  })

  it('ふりがなが無い文はそのまま出す', () => {
    const { container } = render(<Ruby text="こんにちは！" />)
    expect(container.querySelector('ruby')).toBeNull()
    expect(container.textContent).toBe('こんにちは！')
  })

  it('複数のふりがなを扱える', () => {
    const { container } = render(<Ruby text="写真(しゃしん)を選(えら)ぶ" />)
    expect(container.querySelectorAll('ruby')).toHaveLength(2)
  })

  it('ひらがなの括弧はふりがな扱いしない', () => {
    const { container } = render(<Ruby text="ぼく(わたし)" />)
    expect(container.querySelector('ruby')).toBeNull()
  })

  it('span で1つに包む（flex で漢字だけ沈まないように）', () => {
    const { container } = render(<Ruby text="声(こえ)" />)
    expect(container.firstElementChild?.tagName).toBe('SPAN')
  })
})
