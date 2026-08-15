// 環境変数まわり。admin 画面から localStorage で上書きもできる。

const LS_GAS_OVERRIDE = 'koekomi.gasUrlOverride'

function env(name: string): string {
  return ((import.meta.env[name] as string | undefined) ?? '').trim()
}

/** GAS の Web アプリ URL。localStorage の上書き > .env の順で優先。 */
export function getGasUrl(): string {
  const override = localStorage.getItem(LS_GAS_OVERRIDE)
  if (override && override.trim()) return override.trim()
  return env('VITE_GAS_URL')
}

/** admin 画面から GAS URL を上書きする（空文字で解除）。 */
export function setGasUrlOverride(url: string): void {
  if (url.trim()) localStorage.setItem(LS_GAS_OVERRIDE, url.trim())
  else localStorage.removeItem(LS_GAS_OVERRIDE)
}

/**
 * イベントの合言葉。バックエンドの全エンドポイントに付ける。
 *
 * バンドルに載るので完全な秘密ではない。それでも
 * 「アプリのURLを踏んだだけの第三者」と「イベント参加者」は分けられる。
 * 以前はこれが無く、GASの list が全サーバーのURLを公開で返していたため、
 * 誰でも子どもの声でGPUを回し、100MBのファイルを置き、全消しできた。
 */
export function getEventToken(): string {
  return env('VITE_EVENT_TOKEN')
}

/**
 * lastSeen が「新しい」と判定する許容秒数。
 * GAS は混雑すると heartbeat を数回落とすことがあるため余裕をもたせる
 * （割り当て直前に /health を確認するので、死んだ台を掴む心配はない）。
 */
export function getServerFreshSeconds(): number {
  const n = Number(env('VITE_SERVER_FRESH_SECONDS'))
  return Number.isFinite(n) && n > 0 ? n : 300
}
