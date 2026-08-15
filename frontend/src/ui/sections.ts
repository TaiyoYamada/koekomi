// サイドバーの項目。表示用（ふりがな記法）と、読み上げ用の素の名前を持つ。
//
// ふりがなは <ruby> で描くので、そのままだと読み上げ名が
// 「録音 ろくおん」のように二重になる。支援技術を使う子には冗長なので、
// ボタンには aria-label で素の名前を与える。
// （副次的に、E2E のセレクタも安定する）

import type { IconName } from './components/icons'

export interface SectionMeta {
  key: string
  /** 画面に出す文字（漢字(よみ) 記法）。 */
  label: string
  /** 読み上げ・自動テスト用の素の名前。 */
  name: string
  icon: IconName
}

export const SECTIONS = {
  editor: { key: 'editor', label: '編集(へんしゅう)', name: '編集', icon: 'edit' },
  record: { key: 'record', label: '録音(ろくおん)', name: '録音', icon: 'mic' },
  generate: { key: 'generate', label: 'AI声(こえ)', name: 'AI声', icon: 'sparkles' },
  theater: { key: 'theater', label: '劇場(げきじょう)', name: '劇場', icon: 'film' },
} satisfies Record<string, SectionMeta>
