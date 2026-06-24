// 画面をまたいで使う共通ラベル（漢字＋ふりがな記法）。
// 各ステップ固有の文言は、それぞれのコンポーネント内に置いている。

/** 下部ナビの既定ラベル。 */
export const NAV = {
  next: '次(つぎ)へ →',
  back: '← 戻(もど)る',
}

/** 各ステップへ進むボタンの文言（順番に依存しないが導線として表示）。 */
export const NEXT = {
  toLines: 'セリフを書(か)く →',
  toRecord: '声(こえ)を録音(ろくおん) →',
  toTranscribe: '文字(もじ)にする →',
  toGenerate: 'AIで声(こえ)を作(つく)る →',
  toTheater: '4コマ劇場(げきじょう)を見(み)る →',
}

/** 上部タブのラベル。 */
export const TABS = {
  panels: '絵(え)',
  lines: 'セリフ',
  record: '録音(ろくおん)',
  transcribe: '文字(もじ)',
  generate: 'AI声(こえ)',
  theater: '劇場(げきじょう)',
}
