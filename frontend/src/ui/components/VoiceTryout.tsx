import { useEffect, useRef } from 'react'
import { Ruby } from './Furigana'
import { ensureAudioUrl } from '../../application/audioUrls'
import { useConnection } from '../../application/connection'
import {
  prepareTryout,
  TRYOUT_PRESETS,
  tryoutAudioKey,
  useTryout,
  useVoice,
} from '../../application/voiceJobs'

/**
 * 録音した声で、決まった言葉をその場で喋らせてみる（お試し）。
 *
 * 「AI音声を作る」処理そのものは application/voiceJobs.ts にあり、
 * ここは押すだけ。以前はこのコンポーネントが GenerateVoices.tsx と
 * 同じ生成手順を丸ごとコピーして持っていた。
 */
export function VoiceTryout() {
  const { assignment } = useConnection()
  const { hasRecording } = useVoice()
  const tryout = useTryout()
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const ready = assignment !== null && hasRecording

  // 録音（またはサーバー）が変わったら自動で準備する。
  useEffect(() => {
    if (ready) void prepareTryout()
  }, [ready, assignment?.serverId, hasRecording])

  if (!ready) return null

  async function play(phrase: string) {
    const url = await ensureAudioUrl(tryoutAudioKey(phrase))
    if (!url) return
    // 見える再生バーは出さず、押した瞬間に鳴らす（ボタン操作なので自動再生OK）。
    if (!audioRef.current) audioRef.current = new Audio()
    audioRef.current.src = url
    void audioRef.current.play()
  }

  return (
    <div className="card tryout">
      <p className="step-hint" style={{ marginTop: 0 }}>
        <Ruby text="試(ため)しに、あなたのAIの声(こえ)で 言(い)わせてみよう！" />
      </p>

      {tryout.busy && (
        <div className="rec-indicator" role="status">
          <div className="spinner" />
          <Ruby text="AIが あなたの声(こえ)を 覚(おぼ)えているよ…" />
        </div>
      )}
      {tryout.error && !tryout.busy && (
        <div className="banner err">
          <Ruby text="じゅんびに しっぱいしたよ。" />
          <button
            className="btn secondary"
            style={{ marginTop: 8 }}
            onClick={() => void prepareTryout()}
          >
            <Ruby text="もう一度(いちど)じゅんび" />
          </button>
        </div>
      )}

      <div className="tryout-presets">
        {TRYOUT_PRESETS.map((p) => (
          <button
            key={p.say}
            className="btn secondary"
            disabled={!tryout.ready[p.say]}
            onClick={() => void play(p.say)}
          >
            <Ruby text={p.label} />
          </button>
        ))}
      </div>
    </div>
  )
}
