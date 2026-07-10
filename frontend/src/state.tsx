// アプリ全体の状態管理（React Context）。

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { COMA_COUNT, MAX_LINES_PER_COMA, type Assignment, type Coma, type Line, type VoiceMode } from './types'
import { loadMode, saveMode } from './lib/storage'
import {
  REFERENCE_KEY,
  clearWork,
  deserializeWork,
  idbDeleteAudio,
  idbGetAudio,
  idbPutAudio,
  loadWork,
  maxLineSeq,
  persistWork,
  type WorkSnapshot,
} from './lib/persist'

let _seq = 0
function newLine(text = ''): Line {
  return { id: `l${++_seq}`, text, voiceUrl: null }
}
function emptyComas(): Coma[] {
  return Array.from({ length: COMA_COUNT }, () => ({ panelId: null, focusY: 50, lines: [newLine()] }))
}

function moveItem<T>(arr: T[], index: number, dir: -1 | 1): T[] {
  const j = index + dir
  if (j < 0 || j >= arr.length) return arr
  const next = arr.slice()
  ;[next[index], next[j]] = [next[j], next[index]]
  return next
}

export interface AppState {
  // 画面ナビゲーション（プライバシー/設定へ移動して戻っても保持する）
  started: boolean
  setStarted: (v: boolean) => void
  active: string
  setActive: (key: string) => void

  // 接続先
  assignment: Assignment | null
  setAssignment: (a: Assignment | null) => void

  // モード（AI / 自分で録音 / 読み上げ）
  mode: VoiceMode
  setMode: (m: VoiceMode) => void

  // 劇場の再生設定（セクションを移動して戻っても保持する）
  autoPlay: boolean
  setAutoPlay: (v: boolean) => void
  gapSec: number
  setGapSec: (n: number) => void

  // 作品データ（コマ＝写真＋セリフ複数）
  comas: Coma[]
  setComaPanel: (comaIndex: number, panelId: string) => void
  moveComa: (comaIndex: number, dir: -1 | 1) => void
  addLine: (comaIndex: number) => void
  updateLine: (comaIndex: number, lineId: string, text: string) => void
  deleteLine: (comaIndex: number, lineId: string) => void
  moveLine: (comaIndex: number, lineId: string, dir: -1 | 1) => void
  /** lineId に対応する音声URLをセットする。 */
  setLineVoice: (lineId: string, url: string | null) => void
  /** すべてのセリフの音声URLをクリアする。 */
  clearVoices: () => void

  // 録音（参照音声）
  recordingBlob: Blob | null
  recordingUrl: string | null
  setRecording: (blob: Blob | null) => void

  // お試し音声のキャッシュ（セリフ文→音声URL）。メモリ保持。録音が変わると自動で空にする。
  tryoutVoices: Record<string, string>
  setTryoutVoice: (phrase: string, url: string) => void

  /** AI音声を生成中か（本生成・お試し生成のどちらか）。生成中は録り直し等を止めて負荷を増やさない。 */
  generating: boolean
  /** 生成の開始/終了を知らせる。開始で必ず終了を呼ぶこと（複数同時でも数で管理する）。 */
  beginGenerating: () => void
  endGenerating: () => void

  /** 作品データ（コマ・録音・お試し）を消してタイトルに戻す。イベントで次の子に渡すとき用。 */
  resetWork: () => void
}

const Ctx = createContext<AppState | null>(null)

/** 起動時に localStorage から作品を読む（1回だけ）。id の連番も引き継ぐ。 */
function restoreOnBoot(): { snapshot: WorkSnapshot; idbLineIds: string[] } | null {
  const saved = loadWork()
  if (!saved) return null
  _seq = Math.max(_seq, maxLineSeq(saved))
  return deserializeWork(saved)
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  // undefined=未読込。最初のレンダーで一度だけ localStorage を読む。
  const bootRef = useRef<ReturnType<typeof restoreOnBoot> | undefined>(undefined)
  if (bootRef.current === undefined) bootRef.current = restoreOnBoot()
  const boot = bootRef.current

  const [started, setStarted] = useState(boot?.snapshot.started ?? false)
  const [active, setActive] = useState(boot?.snapshot.active ?? 'editor')
  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [mode, setModeState] = useState<VoiceMode>(() => loadMode())
  const [comas, setComas] = useState<Coma[]>(() => boot?.snapshot.comas ?? emptyComas())
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null)
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [tryoutVoices, setTryoutVoices] = useState<Record<string, string>>({})
  const [autoPlay, setAutoPlay] = useState(boot?.snapshot.autoPlay ?? false)
  const [gapSec, setGapSec] = useState(boot?.snapshot.gapSec ?? 0.5)
  // 進行中の生成リクエスト数（本生成＋お試し）。0より大きい間は「生成中」。
  const [genCount, setGenCount] = useState(0)

  // 「この blob: URL は IndexedDB 保存済み」の対応表（persistWork が更新する）。
  const savedUrlsRef = useRef(new Map<string, string>())

  // 起動時: IndexedDB から音声Blobを読み戻して object URL を貼り直す。
  useEffect(() => {
    let alive = true
    void (async () => {
      for (const id of bootRef.current?.idbLineIds ?? []) {
        const blob = await idbGetAudio(id)
        if (!alive || !blob) continue
        const url = URL.createObjectURL(blob)
        savedUrlsRef.current.set(id, url)
        setComas((prev) =>
          prev.map((c) => ({
            ...c,
            lines: c.lines.map((l) => (l.id === id ? { ...l, voiceUrl: url } : l)),
          })),
        )
      }
      const ref = await idbGetAudio(REFERENCE_KEY)
      if (alive && ref) {
        setRecordingBlob((prev) => prev ?? ref)
        setRecordingUrl((prev) => prev ?? URL.createObjectURL(ref))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // 変更のたびに保存（打鍵中に連続保存しないよう少し待つ）。
  useEffect(() => {
    const t = setTimeout(() => {
      void persistWork({ comas, started, active, autoPlay, gapSec }, savedUrlsRef.current)
    }, 300)
    return () => clearTimeout(t)
  }, [comas, started, active, autoPlay, gapSec])

  function mapComa(comaIndex: number, fn: (c: Coma) => Coma) {
    setComas((prev) => prev.map((c, i) => (i === comaIndex ? fn(c) : c)))
  }

  const value = useMemo<AppState>(
    () => ({
      started,
      setStarted,
      active,
      setActive,
      assignment,
      setAssignment,
      mode,
      setMode: (m) => {
        setModeState(m)
        saveMode(m)
      },
      autoPlay,
      setAutoPlay,
      gapSec,
      setGapSec,
      comas,
      setComaPanel: (comaIndex, panelId) => mapComa(comaIndex, (c) => ({ ...c, panelId, focusY: 50 })),
      moveComa: (comaIndex, dir) => setComas((prev) => moveItem(prev, comaIndex, dir)),
      addLine: (comaIndex) =>
        mapComa(comaIndex, (c) =>
          c.lines.length >= MAX_LINES_PER_COMA ? c : { ...c, lines: [...c.lines, newLine()] },
        ),
      updateLine: (comaIndex, lineId, text) =>
        mapComa(comaIndex, (c) => ({
          ...c,
          lines: c.lines.map((l) => (l.id === lineId ? { ...l, text } : l)),
        })),
      deleteLine: (comaIndex, lineId) =>
        mapComa(comaIndex, (c) => {
          const lines = c.lines.filter((l) => l.id !== lineId)
          // 0個にはせず、最低1つの空セリフを残す。
          return { ...c, lines: lines.length ? lines : [newLine()] }
        }),
      moveLine: (comaIndex, lineId, dir) =>
        mapComa(comaIndex, (c) => {
          const idx = c.lines.findIndex((l) => l.id === lineId)
          return idx < 0 ? c : { ...c, lines: moveItem(c.lines, idx, dir) }
        }),
      setLineVoice: (lineId, url) =>
        setComas((prev) =>
          prev.map((c) => ({
            ...c,
            lines: c.lines.map((l) => (l.id === lineId ? { ...l, voiceUrl: url } : l)),
          })),
        ),
      clearVoices: () =>
        setComas((prev) =>
          prev.map((c) => ({ ...c, lines: c.lines.map((l) => ({ ...l, voiceUrl: null })) })),
        ),
      recordingBlob,
      recordingUrl,
      setRecording: (blob) => {
        setRecordingBlob(blob)
        setRecordingUrl((prevUrl) => {
          if (prevUrl) URL.revokeObjectURL(prevUrl)
          return blob ? URL.createObjectURL(blob) : null
        })
        // 録音が変わったら、古い声のお試しキャッシュは無効。
        setTryoutVoices({})
        // リロード対策: 参照録音は IndexedDB にも置いておく。
        if (blob) void idbPutAudio(REFERENCE_KEY, blob)
        else void idbDeleteAudio(REFERENCE_KEY)
      },
      tryoutVoices,
      setTryoutVoice: (phrase, url) =>
        setTryoutVoices((prev) => ({ ...prev, [phrase]: url })),
      generating: genCount > 0,
      beginGenerating: () => setGenCount((n) => n + 1),
      endGenerating: () => setGenCount((n) => Math.max(0, n - 1)),
      resetWork: () => {
        setComas(emptyComas())
        setRecordingBlob(null)
        setRecordingUrl((prevUrl) => {
          if (prevUrl) URL.revokeObjectURL(prevUrl)
          return null
        })
        setTryoutVoices({})
        setStarted(false)
        // 保存データも消す（次の子に渡すとき、前の子の作品が復元されないように）。
        savedUrlsRef.current.clear()
        void clearWork()
      },
    }),
    [started, active, assignment, mode, autoPlay, gapSec, comas, recordingBlob, recordingUrl, tryoutVoices, genCount],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used within AppStateProvider')
  return ctx
}
