// 環境変数まわりの設定。admin 画面から localStorage で上書きもできる。

const LS_GAS_OVERRIDE = 'vct.gasUrlOverride'

/** GAS の Web アプリ URL を返す。localStorage の上書き > .env の順で優先。 */
export function getGasUrl(): string {
  const override = localStorage.getItem(LS_GAS_OVERRIDE)
  if (override && override.trim()) return override.trim()
  return (import.meta.env.VITE_GAS_URL as string | undefined)?.trim() ?? ''
}

/** admin 画面から GAS URL を上書きする（空文字で解除）。 */
export function setGasUrlOverride(url: string): void {
  if (url.trim()) localStorage.setItem(LS_GAS_OVERRIDE, url.trim())
  else localStorage.removeItem(LS_GAS_OVERRIDE)
}

/** lastSeen が「新しい」と判定する許容秒数。
 * GAS は混雑すると heartbeat を数回落とすことがあるため、余裕をもたせる
 * （割り当て直前に /health を確認するので、死んだ台を掴む心配はない）。 */
export function getServerFreshSeconds(): number {
  const raw = import.meta.env.VITE_SERVER_FRESH_SECONDS as string | undefined
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : 300
}
