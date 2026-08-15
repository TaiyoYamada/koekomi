import { useEffect } from 'react'
import { Sidebar } from './ui/components/Sidebar'
import { ServerBadge } from './ui/components/ServerBadge'
import { Ruby } from './ui/components/Furigana'
import { SECTIONS, type SectionMeta } from './ui/sections'
import { Home } from './ui/steps/Home'
import { Editor } from './ui/steps/Editor'
import { Record } from './ui/steps/Record'
import { GenerateVoices } from './ui/steps/GenerateVoices'
import { SelfRecordComas } from './ui/steps/SelfRecordComas'
import { Theater } from './ui/steps/Theater'
import { connect, reassign, useConnection } from './application/connection'
import { restoreRecording, resumeJobIfAny } from './application/voiceJobs'
import { useMode, useUi, workActions } from './application/workStore'
import type { VoiceMode } from './domain/types'

interface Section {
  meta: SectionMeta
  Comp: () => JSX.Element
}

/** モードごとの画面構成（順番なし。サイドバーで自由に行き来できる）。 */
function sectionsForMode(mode: VoiceMode): Section[] {
  const editor: Section = { meta: SECTIONS.editor, Comp: Editor }
  const theater: Section = { meta: SECTIONS.theater, Comp: Theater }
  if (mode === 'self-record')
    return [editor, { meta: SECTIONS.record, Comp: SelfRecordComas }, theater]
  if (mode === 'browser-tts') return [editor, theater]
  // AIモードは「まず声を録る→お試し」から始めたいので録音を先頭にする。
  return [
    { meta: SECTIONS.record, Comp: Record },
    editor,
    { meta: SECTIONS.generate, Comp: GenerateVoices },
    theater,
  ]
}

export function App() {
  const mode = useMode()
  const { started, active } = useUi()
  const connection = useConnection()

  // AIモードのときだけサーバーにつなぐ。
  useEffect(() => {
    if (mode !== 'ai') return
    void connect()
  }, [mode])

  // 起動時: 保存済みの録音と、中断していた生成ジョブを引き継ぐ。
  // 以前は 210秒の同期POSTだったので、リロードすると
  // サーバー上に音声があるのに全部失っていた。
  useEffect(() => {
    void restoreRecording()
  }, [])

  useEffect(() => {
    if (connection.status === 'connected') void resumeJobIfAny()
  }, [connection.status, connection.assignment?.serverId])

  const sections = sectionsForMode(mode)
  const activeSection = sections.find((s) => s.meta.key === active) ?? sections[0]

  if (!started)
    return (
      <Home
        onStart={() => {
          // モードごとの先頭セクションに着地する（AI=録音 / それ以外=編集）。
          workActions.setActive(sections[0].meta.key)
          workActions.setStarted(true)
        }}
      />
    )

  // 各セクションは普通にアンマウントしてよい。長時間の処理（生成・書き出し）は
  // React の外（application 層）が持っているので、画面を離れても切れない。
  // 以前は全画面をマウントしたまま hidden で隠す回避策が必要だった。
  const Active = activeSection.Comp

  return (
    <div className="layout">
      <Sidebar
        items={sections.map((s) => s.meta)}
        active={activeSection.meta.key}
        onSelect={workActions.setActive}
      />

      <main className="main">
        <ServerBadge connection={connection} mode={mode} />

        {mode === 'ai' && connection.status === 'failed' && (
          <div className="banner err">
            <div
              className="row"
              style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}
            >
              <button className="btn secondary" onClick={() => void reassign()}>
                <Ruby text="別(べつ)のサーバーにつなぐ" />
              </button>
              <button className="btn secondary" onClick={() => workActions.setMode('self-record')}>
                <Ruby text="自分(じぶん)で録音(ろくおん)モード" />
              </button>
              <button className="btn secondary" onClick={() => workActions.setMode('browser-tts')}>
                <Ruby text="読(よ)み上(あ)げモード" />
              </button>
            </div>
          </div>
        )}

        <Active />
      </main>
    </div>
  )
}
