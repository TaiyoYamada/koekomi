// 作品のリロード対策（授業の間だけ持てばよい、端末に1作品）。
//
// - localStorage: 作品のJSON（セリフ文・パネル・focusY・画面位置・再生設定）
// - IndexedDB:    音声Blob（自分録音のセリフ、AI用の参照録音）
//   ※ AI生成音声はサーバーURLのまま文字列で保存する（ローカルには落とさない方針）。
//     サーバーが落ちていたら再生成してもらう。
//
// どの関数も失敗を握りつぶす（プライベートモード等でストレージが使えなくても
// アプリ自体は動き続けることを優先する）。

import type { Coma } from '../types'

const LS_WORK = 'vct.work.v1'

/** IndexedDB 上の参照録音（AIモードで学習させる声）のキー。 */
export const REFERENCE_KEY = 'reference'

// ===== 保存形式 =====

interface SavedLine {
  id: string
  text: string
  /** null=音声なし / 'idb'=IndexedDBにBlobあり / それ以外=サーバー等のURL文字列 */
  voice: string | null
}
interface SavedComa {
  panelId: string | null
  focusY: number
  lines: SavedLine[]
}
export interface SavedWork {
  v: 1
  savedAt: number
  started: boolean
  active: string
  autoPlay: boolean
  gapSec: number
  comas: SavedComa[]
}

export interface WorkSnapshot {
  comas: Coma[]
  started: boolean
  active: string
  autoPlay: boolean
  gapSec: number
}

// ===== 純粋な変換（テスト対象） =====

/**
 * アプリの状態を保存形式にする。
 * markers は lineId → 保存する voice 値（persistWork が Blob の保存結果から作る）。
 */
export function serializeWork(snap: WorkSnapshot, markers: Map<string, string | null>): SavedWork {
  return {
    v: 1,
    savedAt: Date.now(),
    started: snap.started,
    active: snap.active,
    autoPlay: snap.autoPlay,
    gapSec: snap.gapSec,
    comas: snap.comas.map((c) => ({
      panelId: c.panelId,
      focusY: c.focusY,
      lines: c.lines.map((l) => ({ id: l.id, text: l.text, voice: markers.get(l.id) ?? null })),
    })),
  }
}

/**
 * 保存形式からアプリの状態へ戻す。
 * 'idb' の音声はまだ読めていないので voiceUrl=null とし、あとから読むための id 一覧を返す。
 */
export function deserializeWork(saved: SavedWork): {
  snapshot: WorkSnapshot
  idbLineIds: string[]
} {
  const idbLineIds: string[] = []
  const comas: Coma[] = saved.comas.map((c) => ({
    panelId: typeof c.panelId === 'string' ? c.panelId : null,
    focusY: clampFocus(c.focusY),
    lines: c.lines.map((l) => {
      let voiceUrl: string | null = null
      if (l.voice === 'idb') idbLineIds.push(l.id)
      else if (typeof l.voice === 'string') voiceUrl = l.voice
      return { id: l.id, text: l.text ?? '', voiceUrl }
    }),
  }))
  return {
    snapshot: {
      comas,
      started: !!saved.started,
      active: typeof saved.active === 'string' ? saved.active : 'editor',
      autoPlay: !!saved.autoPlay,
      gapSec: typeof saved.gapSec === 'number' ? saved.gapSec : 0.5,
    },
    idbLineIds,
  }
}

function clampFocus(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50
}

/** 保存済みの id（l12 など）から連番の最大値を得る。新規 id との衝突を防ぐ。 */
export function maxLineSeq(saved: SavedWork): number {
  let max = 0
  for (const c of saved.comas) {
    for (const l of c.lines) {
      const m = /^l(\d+)$/.exec(l.id)
      if (m) max = Math.max(max, Number(m[1]))
    }
  }
  return max
}

// ===== localStorage =====

export function loadWork(): SavedWork | null {
  try {
    const raw = localStorage.getItem(LS_WORK)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedWork
    if (parsed?.v !== 1 || !Array.isArray(parsed.comas)) return null
    return parsed
  } catch {
    return null
  }
}

function saveWorkJson(work: SavedWork): void {
  try {
    localStorage.setItem(LS_WORK, JSON.stringify(work))
  } catch {
    // 容量超過やプライベートモード。保存できなくても続行する。
  }
}

// ===== IndexedDB（音声Blob） =====

const DB_NAME = 'vct-audio'
const STORE = 'audio'

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
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
// Safari は環境（プライベートモード・古い版）によって Blob の IndexedDB 保存に失敗するため。
interface StoredAudio {
  buf: ArrayBuffer
  type: string
}

export async function idbPutAudio(key: string, blob: Blob): Promise<void> {
  const rec: StoredAudio = { buf: await blob.arrayBuffer(), type: blob.type }
  await withStore('readwrite', (s) => s.put(rec, key))
}

export async function idbGetAudio(key: string): Promise<Blob | null> {
  const v = (await withStore<unknown>('readonly', (s) => s.get(key))) as StoredAudio | null
  if (!v || !(v.buf instanceof ArrayBuffer)) return null
  return new Blob([v.buf], { type: v.type || 'application/octet-stream' })
}

export async function idbDeleteAudio(key: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(key))
}

export async function idbClearAudio(): Promise<void> {
  await withStore('readwrite', (s) => s.clear())
}

// ===== まとめて保存・削除 =====

/**
 * 状態をまるごと保存する。
 * blob: の音声は IndexedDB に入れて 'idb' 印を付け、http(s) の音声は URL のまま残す。
 * savedUrls は「この blob: URL はもう IndexedDB に保存済み」の記録（呼び出し側が持ち回す）。
 */
export async function persistWork(
  snap: WorkSnapshot,
  savedUrls: Map<string, string>,
): Promise<void> {
  const markers = new Map<string, string | null>()
  for (const c of snap.comas) {
    for (const l of c.lines) {
      if (!l.voiceUrl) continue
      if (!l.voiceUrl.startsWith('blob:')) {
        markers.set(l.id, l.voiceUrl)
        continue
      }
      if (savedUrls.get(l.id) === l.voiceUrl) {
        markers.set(l.id, 'idb')
        continue
      }
      try {
        const blob = await (await fetch(l.voiceUrl)).blob()
        await idbPutAudio(l.id, blob)
        savedUrls.set(l.id, l.voiceUrl)
        markers.set(l.id, 'idb')
      } catch {
        markers.set(l.id, null)
      }
    }
  }
  saveWorkJson(serializeWork(snap, markers))
}

/** 作品の保存データをすべて消す（resetWork 用）。 */
export async function clearWork(): Promise<void> {
  try {
    localStorage.removeItem(LS_WORK)
  } catch {
    // 消せなくても致命的ではない
  }
  await idbClearAudio()
}
