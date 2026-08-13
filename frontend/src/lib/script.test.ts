import { describe, expect, it } from 'vitest'
import { REFERENCE_SCRIPT, REFERENCE_SCRIPT_LINES } from './script'

describe('REFERENCE_SCRIPT_LINES', () => {
  it('「。」ごとに3行に分かれる', () => {
    expect(REFERENCE_SCRIPT_LINES).toEqual([
      'きょうは とても いい てんきです。',
      'ちいさな ねこが おそとへ でかけました。',
      'ねこは うれしくて、げんきに うたを うたいました。',
    ])
  })

  it('つなげると元の文と1文字も違わない（読む内容と reference_text がずれない）', () => {
    expect(REFERENCE_SCRIPT_LINES.join('')).toBe(REFERENCE_SCRIPT)
  })
})
