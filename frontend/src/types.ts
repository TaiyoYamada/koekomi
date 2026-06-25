// アプリ全体で使う型定義。

/** サーバー色のキー（最大10台ぶん）。 */
export type ServerColor =
  | 'red'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'purple'
  | 'orange'
  | 'pink'
  | 'cyan'
  | 'brown'
  | 'black'

/** GAS / Google Sheets に保存される Colab サーバー1台分の情報。 */
export interface ServerInfo {
  serverId: string
  color: ServerColor
  label: string
  apiUrl: string
  enabled: boolean
  capacity: number
  assignedCount: number
  /** TTL方式のライブ在席数（GAS が presence から算出）。 */
  activeCount?: number
  /** ISO文字列 または epoch(ms)。GAS の実装に合わせて文字列で扱う。 */
  lastSeen: string
}

/** この端末（iPad）に割り当てられた接続先。localStorage に保存する。 */
export interface Assignment {
  serverId: string
  color: ServerColor
  label: string
  apiUrl: string
  /** 割り当てた時刻（epoch ms）。 */
  assignedAt: number
}

/** 作品づくりのモード。 */
export type VoiceMode =
  | 'ai' // AIで声を作る（通常）
  | 'self-record' // 自分でコマごとに録音する（フォールバック）
  | 'browser-tts' // 端末の読み上げ音声で再生する（フォールバック）

/** パネル画像1枚の情報（manifest.json から読み込む）。 */
export interface Panel {
  id: string
  src: string
  label: string
}

/** セリフ1つ（吹き出し）。 */
export interface Line {
  id: string
  text: string
  /** AIモード: 生成音声の URL。 self-record モード: 自分の録音の object URL。 */
  voiceUrl: string | null
}

/** 1コマ分のデータ（写真1枚＋セリフ複数）。 */
export interface Coma {
  panelId: string | null
  lines: Line[]
}

/** 1コマあたりのセリフ上限。 */
export const MAX_LINES_PER_COMA = 4
/** コマ数（固定）。 */
export const COMA_COUNT = 4

/** /generate-comic-voices のレスポンス。 */
export interface GenerateVoicesResponse {
  /** 各コマの音声ファイル名（/files/{filename} で取得できる）。 */
  files: string[]
}
