// アプリ全体の状態管理（React Context）。

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { COMA_COUNT, MAX_LINES_PER_COMA, type Assignment, type Coma, type Line, type VoiceMode } from './types'
import { loadMode, saveMode } from './lib/storage'

let _seq = 0
function newLine(text = ''): Line {
  return { id: `l${++_seq}`, text, voiceUrl: null }
}
function emptyComas(): Coma[] {
  return Array.from({ length: COMA_COUNT }, () => ({ panelId: null, lines: [newLine()] }))
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

  /** 作品データ（コマ・録音・お試し）を消してタイトルに戻す。イベントで次の子に渡すとき用。 */
  resetWork: () => void
}

const Ctx = createContext<AppState | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [started, setStarted] = useState(false)
  const [active, setActive] = useState('editor')
  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [mode, setModeState] = useState<VoiceMode>(() => loadMode())
  const [comas, setComas] = useState<Coma[]>(() => emptyComas())
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null)
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [tryoutVoices, setTryoutVoices] = useState<Record<string, string>>({})
  const [autoPlay, setAutoPlay] = useState(false)
  const [gapSec, setGapSec] = useState(1)

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
      setComaPanel: (comaIndex, panelId) => mapComa(comaIndex, (c) => ({ ...c, panelId })),
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
      },
      tryoutVoices,
      setTryoutVoice: (phrase, url) =>
        setTryoutVoices((prev) => ({ ...prev, [phrase]: url })),
      resetWork: () => {
        setComas(emptyComas())
        setRecordingBlob(null)
        setRecordingUrl((prevUrl) => {
          if (prevUrl) URL.revokeObjectURL(prevUrl)
          return null
        })
        setTryoutVoices({})
        setStarted(false)
      },
    }),
    [started, active, assignment, mode, autoPlay, gapSec, comas, recordingBlob, recordingUrl, tryoutVoices],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used within AppStateProvider')
  return ctx
}
