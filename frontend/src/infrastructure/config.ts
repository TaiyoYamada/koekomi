// 環境変数まわり。

function env(name: string): string {
  return ((import.meta.env[name] as string | undefined) ?? '').trim()
}

/**
 * GAS の Web アプリ URL（サーバー名簿）。
 *
 * 以前は先生用設定から端末ごとに上書きできたが、名簿は1つしか使わないため
 * 外した。端末ごとに別の名簿を向ける手段があると、1台だけ違う名簿を見て
 * 「その iPad だけサーバーが見つからない」という直しにくい状態を作れてしまう。
 */
export function getGasUrl(): string {
  return env('VITE_GAS_URL')
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
