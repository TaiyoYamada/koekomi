// アプリ全体の状態管理（React Context）。

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Assignment, VoiceMode } from './types'
import { loadMode, saveMode } from './lib/storage'

export interface AppState {
  // 接続先
  assignment: Assignment | null
  setAssignment: (a: Assignment | null) => void

  // モード（AI / 自分で録音 / 読み上げ）
  mode: VoiceMode
  setMode: (m: VoiceMode) => void

  // 作品データ
  /** 選んだパネルID（最大4枚, 順番つき）。 */
  selectedPanels: string[]
  setSelectedPanels: (p: string[]) => void
  /** 4つのセリフ。 */
  lines: string[]
  setLine: (index: number, text: string) => void

  // 録音（参照音声）
  recordingBlob: Blob | null
  recordingUrl: string | null
  setRecording: (blob: Blob | null) => void

  // 文字起こし結果（編集可能・TTSの参照テキスト）
  referenceText: string
  setReferenceText: (t: string) => void

  // 各コマの音声URL（AIモード: 生成音声 / self-record: 自分の録音）
  comaVoiceUrls: (string | null)[]
  setComaVoiceUrl: (index: number, url: string | null) => void
}

const Ctx = createContext<AppState | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [mode, setModeState] = useState<VoiceMode>(() => loadMode())
  const [selectedPanels, setSelectedPanels] = useState<string[]>([])
  const [lines, setLines] = useState<string[]>(['', '', '', ''])
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null)
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [referenceText, setReferenceText] = useState('')
  const [comaVoiceUrls, setComaVoiceUrls] = useState<(string | null)[]>([null, null, null, null])

  const value = useMemo<AppState>(
    () => ({
      assignment,
      setAssignment,
      mode,
      setMode: (m) => {
        setModeState(m)
        saveMode(m)
      },
      selectedPanels,
      setSelectedPanels,
      lines,
      setLine: (i, text) =>
        setLines((prev) => prev.map((l, idx) => (idx === i ? text : l))),
      recordingBlob,
      recordingUrl,
      setRecording: (blob) => {
        setRecordingBlob(blob)
        setRecordingUrl((prevUrl) => {
          if (prevUrl) URL.revokeObjectURL(prevUrl)
          return blob ? URL.createObjectURL(blob) : null
        })
      },
      referenceText,
      setReferenceText,
      comaVoiceUrls,
      setComaVoiceUrl: (i, url) =>
        setComaVoiceUrls((prev) => prev.map((u, idx) => (idx === i ? url : u))),
    }),
    [assignment, mode, selectedPanels, lines, recordingBlob, recordingUrl, referenceText, comaVoiceUrls],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used within AppStateProvider')
  return ctx
}
