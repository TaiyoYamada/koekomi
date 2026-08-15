// IndexedDB による音声の保管。
//
// **作品の音声の実体はここにある**（サーバーではなく）。
// これが「サーバーはステートレス、クライアントが唯一の所有者」という
// 不変条件を成立させている部分で、3台構成のフェイルオーバーを
// 無損失にしているのもここ。
//
// どの関数も失敗を握りつぶす（プライベートモード等でストレージが
// 使えなくても、アプリ自体は動き続けることを優先する）。

const DB_NAME = 'koekomi-audio'
const STORE = 'audio'

/** 参照録音（AIに覚えさせる声）のキー。行の音声とは別枠で持つ。 */
export const REFERENCE_KEY = 'reference'
/** お試し音声のキー接頭辞。 */
export const TRYOUT_PREFIX = 'tryout:'

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, 1)
    } catch {
      resolve(null)
      return
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null
    return new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(STORE, mode)
        const req = run(tx.objectStore(STORE))
        // resolve はトランザクションのコミット完了まで待つ。
        // リクエスト成功時点で返すと、直後にページを離れた場合に書き込みが消える。
        tx.oncomplete = () => {
          db.close()
          resolve(req.result ?? null)
        }
        tx.onerror = () => {
          db.close()
          resolve(null)
        }
        tx.onabort = () => {
          db.close()
          resolve(null)
        }
      } catch {
        db.close()
        resolve(null)
      }
    })
  })
}

// Blob は ArrayBuffer + MIME に分解して保存する。
// Safari は環境（プライベートモード・古い版）によって Blob の
// IndexedDB 保存に失敗することがあるため。
interface StoredAudio {
  buf: ArrayBuffer
  type: string
}

export async function putAudio(key: string, blob: Blob): Promise<boolean> {
  try {
    const rec: StoredAudio = { buf: await blob.arrayBuffer(), type: blob.type }
    await withStore('readwrite', (s) => s.put(rec, key))
    return true
  } catch {
    return false
  }
}

export async function getAudio(key: string): Promise<Blob | null> {
  const v = (await withStore<unknown>('readonly', (s) => s.get(key))) as StoredAudio | null
  // instanceof は使わない。構造化複製を経ると別レルムの ArrayBuffer になることがあり、
  // その場合 instanceof が false になって「保存したのに読めない」が起きる。
  // 中身を使えるかどうかで判定する。
  if (!v) return null
  const buf = v.buf as ArrayBuffer | undefined
  if (!buf || typeof buf.byteLength !== 'number') return null
  return new Blob([buf], { type: v.type || 'application/octet-stream' })
}

export async function deleteAudio(key: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(key))
}

export async function clearAudio(): Promise<void> {
  await withStore('readwrite', (s) => s.clear())
}

export async function listAudioKeys(): Promise<string[]> {
  const keys = (await withStore<IDBValidKey[]>('readonly', (s) => s.getAllKeys())) ?? []
  return keys.map(String)
}
