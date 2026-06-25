import { useMemo, useState } from 'react'
import { StepHead } from '../components/StepHead'
import { Ruby } from '../components/Furigana'
import { Icon } from '../components/icons'
import { useApp } from '../state'
import { flattenLines } from '../lib/comic'
import { fileUrl, generateComicVoices } from '../lib/api'
import { REFERENCE_SCRIPT } from '../lib/script'

/** AIで声を作る（全コマの全セリフぶんを生成）。 */
export function GenerateVoices() {
  const { assignment, recordingBlob, comas, setLineVoice } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // テキストのあるセリフだけを対象にする。
  const targets = useMemo(
    () => flattenLines(comas).filter((t) => t.line.text.trim()),
    [comas],
  )
  const allDone = targets.length > 0 && targets.every((t) => t.line.voiceUrl)

  async function run() {
    if (!assignment || !recordingBlob || targets.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const res = await generateComicVoices(assignment.apiUrl, {
        audio: recordingBlob,
        referenceText: REFERENCE_SCRIPT,
        lines: targets.map((t) => t.line.text),
      })
      // 返ってきたファイル名は targets と同じ順番。idで対応づける。
      res.files.forEach((name, i) => {
        const t = targets[i]
        if (t) setLineVoice(t.line.id, fileUrl(assignment.apiUrl, name))
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <StepHead
        title="AIで声(こえ)を作(つく)る"
        hint={<Ruby text="あなたの声(こえ)を使(つか)って、書(か)いたセリフを全部(ぜんぶ)その声(こえ)で作(つく)るよ" />}
      />

      {!recordingBlob && (
        <div className="banner warn">
          <Ruby text="先(さき)に「録音(ろくおん)」で声(こえ)を録音(ろくおん)してね。" />
        </div>
      )}
      {targets.length === 0 && (
        <div className="banner warn">
          <Ruby text="「編集(へんしゅう)」でセリフを書(か)いてね。" />
        </div>
      )}
      {error && (
        <div className="banner err">
          <Ruby text="うまくいかなかったよ：" />
          {error}
          <br />
          <Ruby text="先生(せんせい)に言(い)って、別(べつ)のサーバーにつなぎ直(なお)すか、フォールバックモードを使(つか)ってね。" />
        </div>
      )}

      <div className="card center">
        <button
          className="btn big icon-btn"
          onClick={run}
          disabled={busy || !assignment || !recordingBlob || targets.length === 0}
        >
          <Icon name="sparkles" size={22} />
          <Ruby text={busy ? '声(こえ)を作(つく)っているよ…' : allDone ? 'もう一度(いちど)作(つく)る' : '声(こえ)を作(つく)る'} />
        </button>
        {busy && (
          <>
            <div className="spinner" />
            <p className="step-hint">
              <Ruby text="順番(じゅんばん)に作(つく)っているよ。少(すこ)し待(ま)ってね。" />
            </p>
          </>
        )}
      </div>

      {targets.some((t) => t.line.voiceUrl) && (
        <div className="card">
          {allDone && (
            <div className="banner ok">
              <Ruby text="できたよ！1つずつ聞(き)いてみよう。" />
            </div>
          )}
          {comas.map((coma, ci) =>
            coma.lines
              .filter((l) => l.text.trim())
              .map((l) => (
                <div key={l.id} style={{ marginBottom: 12 }}>
                  <div className="coma-no">
                    <Ruby text={`${ci + 1}枚目(まいめ)：`} />
                    {l.text}
                  </div>
                  {l.voiceUrl && <audio src={l.voiceUrl} controls style={{ width: '100%' }} />}
                </div>
              )),
          )}
        </div>
      )}
    </div>
  )
}
