/* コエコミの Service Worker。
 *
 * ■ なぜ要るか
 *   学校のWi-Fiは不安定で、体育館や特別教室では途切れることがある。
 *   アプリ本体（HTML/JS/CSS）と写真をキャッシュしておけば、
 *   **電波が切れてもアプリは開くし、作業も続けられる**
 *   （作品は IndexedDB にあるので、生成以外は全部ローカルで完結する）。
 *
 * ■ 方針
 *   - アプリの外枠（HTML/JS/CSS/アイコン）: キャッシュ優先 + 裏で更新
 *   - 写真（/panels/）: キャッシュ優先（内容が変わらないので）
 *   - API（Colab / GAS）: **絶対にキャッシュしない**
 *     子どもの声や生成結果を端末に二重に残さないため、そして
 *     古い待ち順位を表示しないため。
 *
 * ■ 更新
 *   VERSION を上げると古いキャッシュを捨てる。
 *   デプロイのたびに Vite がファイル名にハッシュを付けるので、
 *   実質は index.html だけ取り直せば新しい版に入れ替わる。
 */

const VERSION = 'koekomi-v1'
const SHELL_CACHE = `${VERSION}-shell`
const PANEL_CACHE = `${VERSION}-panels`

/** 最初から入れておくもの（オフラインでも開けるように）。 */
const SHELL = ['/', '/index.html', '/site.webmanifest', '/mascot.png', '/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // 1つ落とせなくても入れられるぶんは入れる（写真が増減しても壊れない）。
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  )
})

/** バックエンド・名簿への通信か（＝キャッシュしてはいけないもの）。 */
function isApiRequest(url) {
  if (url.origin !== self.location.origin) return true // Colab / GAS は別オリジン
  return (
    url.pathname.startsWith('/voices') ||
    url.pathname.startsWith('/jobs') ||
    url.pathname.startsWith('/artifacts') ||
    url.pathname.startsWith('/render') ||
    url.pathname.startsWith('/ops')
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // 子どもの声・生成物・待ち順位は絶対にキャッシュしない。
  if (isApiRequest(url)) return

  // 写真は変わらないのでキャッシュ優先。
  if (url.pathname.startsWith('/panels/')) {
    event.respondWith(cacheFirst(request, PANEL_CACHE))
    return
  }

  // 画面遷移はまずネット、ダメならキャッシュした index.html
  // （SPA なのでどのパスでも index.html を返せばよい）。
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((r) => r || offlineResponse())),
    )
    return
  }

  // それ以外（JS/CSS/アイコン）はキャッシュ優先 + 裏で更新。
  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE))
})

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(cacheName)
    cache.put(request, response.clone())
  }
  return response
}

async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request)
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(cacheName)
        cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => cached)
  return cached || network
}

function offlineResponse() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>コエコミ</title>' +
      '<body style="font-family:system-ui;padding:2rem;text-align:center">' +
      '<h1>つながらないよ</h1><p>ネットにつないでから、もう一度ひらいてね。</p>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
  )
}
