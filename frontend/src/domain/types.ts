// ドメインで使う小さな型。

/** サーバー色のキー（サイドバーのロゴの地色に使う）。 */
export type ServerColor =
  'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'pink' | 'cyan' | 'brown' | 'black'

/** サーバー名簿（GAS）の1行。負荷分散をやめたので capacity 等は持たない。 */
export interface ServerInfo {
  serverId: string
  color: ServerColor
  label: string
  apiUrl: string
  enabled: boolean
  /** ISO文字列 または epoch(ms)。 */
  lastSeen: string
}

/** この端末が使うことにしたサーバー。 */
export interface Assignment {
  serverId: string
  color: ServerColor
  label: string
  apiUrl: string
  assignedAt: number
  /** サーバー側で動画を作れるか（/health より）。false ならクライアント書き出し。 */
  canRender: boolean
}

/** 作品づくりのモード。 */
export type VoiceMode =
  | 'ai' // AIで声を作る（通常）
  | 'self-record' // 自分でセリフごとに録音する（フォールバック）
  | 'browser-tts' // 端末の読み上げ音声で再生する（フォールバック）

/** パネル画像1枚の情報（manifest.json から読み込む）。 */
export interface Panel {
  id: string
  /** 公開パス（`/panels/xxx.jpg`）。サーバーのレンダリングにもこれを渡す。 */
  src: string
  label: string
}
