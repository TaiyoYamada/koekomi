import { useState } from 'react'
import { StepHead } from '../components/StepHead'
import { NavBar } from '../components/NavBar'
import { Ruby } from '../components/Furigana'
import { NEXT } from '../ui/labels'
import { useApp } from '../state'
import { fileUrl, generateComicVoices } from '../lib/api'
import type { StepProps } from './types'

/** ステップ: AIで声を作る（4コマぶんの音声を生成）。 */
export function GenerateVoices({ stepNumber, goNext, goBack }: StepProps) {
  const { assignment, recordingBlob, referenceText, lines, comaVoiceUrls, setComaVoiceUrl } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allDone = comaVoiceUrls.every((u) => !!u)

  async function run() {
    if (!assignment || !recordingBlob) return
    setBusy(true)
    setError(null)
    try {
      const res = await generateComicVoices(assignment.apiUrl, {
        audio: recordingBlob,
        referenceText,
        lines: [lines[0], lines[1], lines[2], lines[3]],
      })
      res.files.forEach((name, i) => setComaVoiceUrl(i, fileUrl(assignment.apiUrl, name)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <StepHead
        num={stepNumber}
        title="AIで声(こえ)を作(つく)る"
        hint={<Ruby text="あなたの声(こえ)を使(つか)って、4つのセリフを話(はな)す声(こえ)を作(つく)るよ" />}
      />

      {error && (
        <div className="banner err">
          <Ruby text="うまくいかなかったよ：" />
          {error}
          <br />
          <Ruby text="先生(せんせい)に言(い)って、別(べつ)のサーバーにつなぎ直(なお)すか、フォールバックモードを使(つか)ってね。" />
        </div>
      )}

      <div className="card center">
        <button className="btn big" onClick={run} disabled={busy || !assignment}>
          <Ruby
            text={busy ? '声(こえ)を作(つく)っているよ…' : allDone ? 'もう一度(いちど)作(つく)る' : '🎙️ 声(こえ)を作(つく)る'}
          />
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

      {allDone && (
        <div className="card">
          <div className="banner ok">
            <Ruby text="できたよ！1つずつ聞(き)いてみよう。" />
          </div>
          {comaVoiceUrls.map((u, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div className="coma-no">
                <Ruby text={`${i + 1}コマ目(め)：`} />
                {lines[i] || '（なし）'}
              </div>
              {u && <audio src={u} controls style={{ width: '100%' }} />}
            </div>
          ))}
        </div>
      )}

      <NavBar onBack={goBack} onNext={goNext} nextDisabled={!allDone} nextLabel={NEXT.toTheater} />
    </div>
  )
}
