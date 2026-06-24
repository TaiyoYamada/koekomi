import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from './state'
import { ensureAssignment, assignFreshServer } from './lib/registry'
import { ServerBadge } from './components/ServerBadge'
import { StepTabs } from './components/StepTabs'
import { Ruby } from './components/Furigana'
import { TABS } from './ui/labels'
import type { StepProps } from './steps/types'
import { SelectPanels } from './steps/SelectPanels'
import { WriteLines } from './steps/WriteLines'
import { Record } from './steps/Record'
import { Transcribe } from './steps/Transcribe'
import { GenerateVoices } from './steps/GenerateVoices'
import { SelfRecordComas } from './steps/SelfRecordComas'
import { Theater } from './steps/Theater'
import type { VoiceMode } from './types'

type StepComp = (p: StepProps) => JSX.Element

interface StepDef {
  Comp: StepComp
  label: string
  icon: string
}

const TAB_PANELS: StepDef = { Comp: SelectPanels, label: TABS.panels, icon: '🖼️' }
const TAB_LINES: StepDef = { Comp: WriteLines, label: TABS.lines, icon: '✏️' }
const TAB_THEATER: StepDef = { Comp: Theater, label: TABS.theater, icon: '🎬' }

/** モードごとのステップ構成（順番は強制せず、タブで自由に行き来できる）。 */
function stepsForMode(mode: VoiceMode): StepDef[] {
  if (mode === 'self-record')
    return [TAB_PANELS, TAB_LINES, { Comp: SelfRecordComas, label: TABS.record, icon: '🎤' }, TAB_THEATER]
  if (mode === 'browser-tts') return [TAB_PANELS, TAB_LINES, TAB_THEATER]
  return [
    TAB_PANELS,
    TAB_LINES,
    { Comp: Record, label: TABS.record, icon: '🎤' },
    { Comp: Transcribe, label: TABS.transcribe, icon: '📝' },
    { Comp: GenerateVoices, label: TABS.generate, icon: '🪄' },
    TAB_THEATER,
  ]
}

export function App() {
  const navigate = useNavigate()
  const { assignment, setAssignment, mode, setMode } = useApp()
  const [stepIndex, setStepIndex] = useState(0)
  const [connecting, setConnecting] = useState(false)
  const [connError, setConnError] = useState<string | null>(null)

  // AIモードのときだけ接続を試みる。
  const connect = useCallback(async () => {
    if (mode !== 'ai') return
    setConnecting(true)
    setConnError(null)
    const result = await ensureAssignment()
    if (result.status === 'ok') {
      setAssignment(result.assignment)
    } else {
      setAssignment(null)
      setConnError(result.error)
    }
    setConnecting(false)
  }, [mode, setAssignment])

  useEffect(() => {
    void connect()
  }, [connect])

  async function reassign() {
    setConnecting(true)
    setConnError(null)
    try {
      const a = await assignFreshServer(assignment?.serverId)
      setAssignment(a)
    } catch (e) {
      setAssignment(null)
      setConnError(e instanceof Error ? e.message : String(e))
    } finally {
      setConnecting(false)
    }
  }

  const steps = stepsForMode(mode)
  const clampedIndex = Math.min(stepIndex, steps.length - 1)
  const StepComponent = steps[clampedIndex].Comp

  const goNext = () => setStepIndex((i) => Math.min(i + 1, steps.length - 1))
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0))

  return (
    <div className="app">
      {/* 先生用 管理画面への隠し導線（子どもが触りにくい右上の小さな歯車） */}
      <button className="gear" aria-label="先生用せってい" onClick={() => navigate('/admin')}>
        ⚙
      </button>

      <ServerBadge assignment={assignment} mode={mode} />

      {/* 接続まわりの状態表示（AIモードのみ） */}
      {mode === 'ai' && connecting && (
        <div className="banner">サーバーにつないでいます…</div>
      )}
      {mode === 'ai' && connError && (
        <div className="banner err">
          <Ruby text="サーバーにつなげませんでした。" />
          <div className="row" style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn secondary" onClick={() => void reassign()}>
              <Ruby text="別(べつ)のサーバーにつなぐ" />
            </button>
            <button className="btn secondary" onClick={() => setMode('self-record')}>
              <Ruby text="自分(じぶん)で録音(ろくおん)モード" />
            </button>
            <button className="btn secondary" onClick={() => setMode('browser-tts')}>
              <Ruby text="読(よ)み上(あ)げモード" />
            </button>
          </div>
        </div>
      )}

      <StepTabs
        items={steps.map((s) => ({ label: s.label, icon: s.icon }))}
        current={clampedIndex}
        onPick={setStepIndex}
      />

      <StepComponent
        stepNumber={clampedIndex + 1}
        goNext={goNext}
        goBack={goBack}
        isFirst={clampedIndex === 0}
        isLast={clampedIndex === steps.length - 1}
      />
    </div>
  )
}
