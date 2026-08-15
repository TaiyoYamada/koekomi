import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ruby } from '../components/Furigana'
import { colorDef } from '../colors'
import {
  fetchFleetStatus,
  readRegistryUrl,
  writeRegistryUrl,
  type ServerStatus,
} from '../../application/ops'
import { forgetAssignment, reassign, useConnection } from '../../application/connection'
import { clearSavedWork } from '../../application/persistence'
import { resetVoiceState } from '../../application/voiceJobs'
import { useMode, workActions } from '../../application/workStore'
import type { VoiceMode } from '../../domain/types'

const MODE_LABELS: Record<VoiceMode, string> = {
  ai: 'AIで声を作る（つうじょう）',
  'self-record': '自分で録音モード（フォールバック）',
  'browser-tts': 'ブラウザ読み上げモード（フォールバック）',
}

/**
 * 先生・TA用の画面。認証なしだが、子どもが触りにくい /admin に置く。
 *
 * 以前は「この端末の localStorage を覗く」だけだった。20台のiPadが
 * 個別に不機嫌になったとき、運用者に打つ手が無い。ここでは
 * **サーバー側の事実**（全台の状態・待ち行列）を1画面にまとめる。
 */
export function AdminPanel() {
  const navigate = useNavigate()
  const { assignment, status } = useConnection()
  const mode = useMode()
  const [rows, setRows] = useState<ServerStatus[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gasUrl, setGasUrl] = useState(readRegistryUrl())

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await fetchFleetStatus())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRows(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    // イベント中は開きっぱなしにする想定なので、自動で更新し続ける。
    const id = setInterval(() => void refresh(), 15000)
    return () => clearInterval(id)
  }, [refresh])

  async function doReassign() {
    setBusy(true)
    try {
      await reassign()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function doResetWork() {
    if (!confirm('いまの作品（写真・セリフ・録音）を消して、最初からにします。よろしいですか？'))
      return
    await resetVoiceState()
    await clearSavedWork()
    workActions.resetAll()
    alert('リセットしました。アプリに戻るとタイトルから始められます。')
  }

  return (
    <div className="admin">
      <button className="btn secondary" onClick={() => navigate('/')}>
        ← <Ruby text="アプリに戻(もど)る" />
      </button>
      <h1>先生用設定</h1>

      {/* --- 全台の状態（サーバー側の事実） --- */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>サーバーの状態</h3>
          <button className="btn secondary" onClick={() => void refresh()} disabled={loading}>
            {loading ? '確認中…' : '再確認'}
          </button>
        </div>
        {error && <p className="kv">取得できません: {error}</p>}
        {rows && rows.length === 0 && <p>登録されているサーバーがありません。</p>}
        {rows && rows.length > 0 && (
          <table className="ops-table">
            <thead>
              <tr>
                <th>サーバー</th>
                <th>状態</th>
                <th>音声</th>
                <th>待ち</th>
                <th>動画</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ server, health }) => {
                const c = colorDef(server.color)
                const here = assignment?.serverId === server.serverId
                return (
                  <tr key={server.serverId} className={here ? 'is-current' : undefined}>
                    <td>
                      <span className="kv" style={{ background: c.hex, color: c.fg }}>
                        {c.jp}
                      </span>{' '}
                      <code>{server.serverId}</code>
                      {here && <strong>（この端末）</strong>}
                    </td>
                    <td>
                      {!health
                        ? '❌ 応答なし'
                        : health.status === 'warming'
                          ? '⏳ 準備中'
                          : '✅ 使える'}
                    </td>
                    <td>
                      {health
                        ? health.ttsEffective === 'qwen'
                          ? 'AI'
                          : `⚠️ ${health.ttsEffective}`
                        : '—'}
                    </td>
                    <td>{health ? `${health.queueDepth}行 / ${health.activeJobs}件` : '—'}</td>
                    <td>{health ? (health.canRender ? 'サーバー' : '端末') : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <p className="step-hint">
          「音声」が <code>dummy</code> の台はピー音しか出ません（AIライブラリの読み込み失敗）。
          「待ち」は未処理の行数と、処理中のジョブ数です。
        </p>
      </div>

      {/* --- この端末の接続先 --- */}
      <div className="card">
        <h3>この端末の接続先</h3>
        {assignment ? (
          <ul>
            <li>
              serverId: <code>{assignment.serverId}</code>
            </li>
            <li>
              apiUrl: <code>{assignment.apiUrl}</code>
            </li>
            <li>動画のレンダリング: {assignment.canRender ? 'サーバー側' : 'この端末'}</li>
          </ul>
        ) : (
          <p>未割り当て（状態: {status}）</p>
        )}
        <div className="row">
          <button className="btn secondary" onClick={() => void doReassign()} disabled={busy}>
            別のサーバーへ移る
          </button>
          <button className="btn secondary" onClick={forgetAssignment}>
            接続先リセット
          </button>
        </div>
      </div>

      <div className="card">
        <h3>つぎの子へ（作品リセット）</h3>
        <p className="step-hint" style={{ marginTop: 0 }}>
          写真・セリフ・録音をすべて消します。サーバーに預けた声も削除されます。接続先は保持されます。
        </p>
        <button className="btn stop" onClick={() => void doResetWork()}>
          作品をリセット
        </button>
      </div>

      <div className="card">
        <h3>サーバー名簿のURL</h3>
        <p className="step-hint" style={{ marginTop: 0 }}>
          この端末だけ、別の名簿（GAS）を見に行かせます。空にすると .env の設定に戻ります。
          当日に名簿を差し替えたいとき、再ビルドせずに切り替えられます。
        </p>
        <div className="row">
          <input
            type="text"
            value={gasUrl}
            placeholder="https://script.google.com/macros/s/XXXX/exec"
            onChange={(e) => setGasUrl(e.target.value)}
            style={{ flex: 1, minWidth: 260 }}
            aria-label="サーバー名簿のURL"
          />
          <button
            className="btn secondary"
            onClick={() => {
              writeRegistryUrl(gasUrl)
              void refresh()
            }}
          >
            反映
          </button>
        </div>
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
                onChange={() => workActions.setMode(m)}
              />
              <span>{MODE_LABELS[m]}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
