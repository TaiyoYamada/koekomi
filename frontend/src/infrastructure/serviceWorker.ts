// Service Worker の登録。
//
// 学校のWi-Fiは途切れる。アプリ本体と写真をキャッシュしておけば、
// 電波が切れてもアプリは開き、作業も続けられる（作品は IndexedDB にある）。
//
// 開発中は登録しない。HMR と噛み合わず、古いコードを掴んで混乱するため。

/** 登録する。失敗してもアプリは普通に動く。 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => {
      console.warn('Service Worker を登録できませんでした（オフライン対応なしで続行）', e)
    })
  })
}

/** 登録を外す（開発時や、キャッシュが悪さをしたときの逃げ道）。 */
export async function unregisterServiceWorker(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const registrations = await navigator.serviceWorker.getRegistrations()
  await Promise.all(registrations.map((r) => r.unregister()))
  if ('caches' in window) {
    const names = await caches.keys()
    await Promise.all(names.map((n) => caches.delete(n)))
  }
}
