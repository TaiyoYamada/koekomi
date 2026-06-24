import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../state'
import { colorDef } from '../lib/colors'
import { checkHealth } from '../lib/api'
import { assignFreshServer } from '../lib/registry'
import { clearAssignment, loadAssignment } from '../lib/storage'
import { getGasUrl, setGasUrlOverride } from '../lib/config'
import type { VoiceMode } from '../types'

const MODE_LABELS: Record<VoiceMode, string> = {
  ai: 'AIで声を作る（つうじょう）',
  'self-record': '自分で録音モード（フォールバック）',
  'browser-tts': 'ブラウザ読み上げモード（フォールバック）',
}

/** 先生・TA 用の管理画面。認証なしだが、子どもが触りにくい /admin に置く。 */
export function AdminPanel() {
  const navigate = useNavigate()
  const { assignment, setAssignment, mode, setMode } = useApp()
  const [health, setHealth] = useState<string>('—')
  const [busy, setBusy] = useState(false)
  const [gas, setGas] = useState(getGasUrl())
  const saved = loadAssignment()

  useEffect(() => {
    setGas(getGasUrl())
  }, [])

  async function doHealth() {
    if (!assignment) return
    setHealth('かくにん中…')
    const ok = await checkHealth(assignment.apiUrl)
    setHealth(ok ? '✅ つながっています' : '❌ つながりません')
  }

  async function doReassign() {
    setBusy(true)
    try {
      const a = await assignFreshServer(assignment?.serverId)
      setAssignment(a)
      setHealth('—')
    } catch (e) {
      alert('再割り当てに失敗: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  function doReset() {
    clearAssignment()
    setAssignment(null)
    setHealth('—')
  }

  function saveGas() {
    setGasUrlOverride(gas)
    alert('GAS URL を保存しました（この端末のみ）')
  }

  const c = assignment ? colorDef(assignment.color) : null

  return (
    <div className="admin">
      <button className="btn secondary" onClick={() => navigate('/')}>
        ← アプリにもどる
      </button>
      <h1>先生・TA用 せってい</h1>

      <div className="card">
        <h3>いまの接続先</h3>
        {assignment ? (
          <ul>
            <li>serverId: <code>{assignment.serverId}</code></li>
            <li>
              color:{' '}
              <span
                className="kv"
                style={{ background: c?.hex, color: c?.fg }}
              >
                {c?.jp}（{assignment.color}）
              </span>
            </li>
            <li>label: <code>{assignment.label}</code></li>
            <li>apiUrl: <code>{assignment.apiUrl}</code></li>
          </ul>
        ) : (
          <p>未割り当て（AIモードで接続できていません）</p>
        )}
        <div className="row">
          <button className="btn" onClick={doHealth} disabled={!assignment}>
            /health 接続かくにん
          </button>
          <span className="kv">{health}</span>
        </div>
        <div className="row">
          <button className="btn secondary" onClick={() => void doReassign()} disabled={busy}>
            再割り当て
          </button>
          <button className="btn secondary" onClick={doReset}>
            接続先リセット
          </button>
        </div>
      </div>

      <div className="card">
        <h3>localStorage の保存内容</h3>
        <pre className="kv" style={{ whiteSpace: 'pre-wrap' }}>
          {saved ? JSON.stringify(saved, null, 2) : '（なし）'}
        </pre>
      </div>

      <div className="card">
        <h3>モードの切り替え</h3>
        <div className="mode-pick">
          {(Object.keys(MODE_LABELS) as VoiceMode[]).map((m) => (
            <label key={m}>
              <input
                type="radio"
                name="mode"
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              <span>{MODE_LABELS[m]}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>GAS の URL（この端末のみ上書き）</h3>
        <p className="step-hint" style={{ marginTop: 0 }}>
          ふだんは .env の VITE_GAS_URL を使います。緊急時にここで差し替えできます。
        </p>
        <input
          type="text"
          value={gas}
          onChange={(e) => setGas(e.target.value)}
          placeholder="https://script.google.com/macros/s/XXXX/exec"
        />
        <div className="row">
          <button className="btn" onClick={saveGas}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
