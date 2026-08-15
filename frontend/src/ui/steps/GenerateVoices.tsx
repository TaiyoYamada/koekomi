import { useMemo } from 'react'
import { StepHead } from '../components/StepHead'
import { Ruby } from '../components/Furigana'
import { Icon } from '../components/icons'
import { useAudioUrl } from '../../application/audioUrls'
import { useConnection } from '../../application/connection'
import {
  cancelGeneration,
  generateVoices,
  useGeneration,
  useVoice,
} from '../../application/voiceJobs'
import { useWork } from '../../application/workStore'
import { meaningfulLines } from '../../domain/work'
import type { Line } from '../../domain/work'

/** 1行ぶんの試聴。音声は IndexedDB から解決する（サーバーURLを触らない）。 */
function LinePlayback({ comaIndex, line }: { comaIndex: number; line: Line }) {
  const url = useAudioUrl(line.audio)
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="coma-no">
        <Ruby text={`${comaIndex + 1}枚目(まいめ)：`} />
        {line.text}
      </div>
      {url && (
        <audio
          src={url}
          controls
          style={{ width: '100%' }}
          onPlay={(e) => {
            // 同時再生させない。
            const current = e.currentTarget
            document.querySelectorAll('audio').forEach((a) => {
              if (a !== current) a.pause()
            })
          }}
        />
      )}
    </div>
  )
}

/** AIで声を作る（全コマの全セリフぶん）。 */
export function GenerateVoices() {
  const { assignment } = useConnection()
  const { hasRecording } = useVoice()
  const work = useWork()
  const gen = useGeneration()

  const targets = useMemo(
    () => meaningfulLines(work).filter(({ line }) => line.text.trim()),
    [work],
  )
  const withVoice = targets.filter(({ line }) => line.audio.kind === 'stored')
  const allDone = targets.length > 0 && withVoice.length === targets.length
  const busy = gen.phase === 'queued' || gen.phase === 'running' || gen.phase === 'saving'

  return (
    <div>
      <StepHead
        title="AIで声(こえ)を作(つく)る"
        hint={
          <Ruby text="あなたの声(こえ)を使(つか)って、書(か)いたセリフを全部(ぜんぶ)その声(こえ)で作(つく)るよ" />
        }
      />

      {!hasRecording && (
        <div className="banner warn">
          <Ruby text="先(さき)に「録音(ろくおん)」で声(こえ)を録音(ろくおん)してね。" />
        </div>
      )}
      {targets.length === 0 && (
        <div className="banner warn">
          <Ruby text="「編集(へんしゅう)」でセリフを書(か)いてね。" />
        </div>
      )}
      {!busy && gen.error && (
        <div className="banner err" role="alert">
          <Ruby text={gen.error} />
          <br />
          <Ruby text="何度(なんど)もだめなら、先生(せんせい)に言(い)って、別(べつ)のサーバーにつなぎ直(なお)すか、フォールバックモードを使(つか)ってね。" />
        </div>
      )}

      <div className="card center">
        {!busy ? (
          <button
            className="btn big icon-btn"
            aria-label={allDone ? 'もう一度作る' : '声を作る'}
            onClick={() => void generateVoices()}
            disabled={!assignment || !hasRecording || targets.length === 0}
          >
            <Icon name="sparkles" size={22} />
            <Ruby text={allDone ? 'もう一度(いちど)作(つく)る' : '声(こえ)を作(つく)る'} />
          </button>
        ) : (
          <button
            className="btn stop big icon-btn"
            aria-label="やめる"
            onClick={() => void cancelGeneration()}
          >
            <Icon name="stop" size={20} />
            <Ruby text="やめる" />
          </button>
        )}

        {busy && (
          <>
            <div className="spinner" />
            {/* 待ち順位を出す。3分の無言スピナーより、順番が見えるほうが待てる。 */}
            {gen.queuePosition > 0 ? (
              <p className="step-hint">
                <Ruby
                  text={`あと ${gen.queuePosition}にん まちだよ。じゅんばんに 作(つく)っているよ。`}
                />
              </p>
            ) : (
              <p className="step-hint">
                <Ruby text={`作(つく)っているよ… ${gen.finished} / ${gen.total}`} />
              </p>
            )}
            <div className="progress-track" aria-hidden>
              <div
                className="progress-bar"
                style={{
                  width: `${gen.total ? Math.round((gen.finished / gen.total) * 100) : 0}%`,
                }}
              />
            </div>
          </>
        )}
      </div>

      {withVoice.length > 0 && (
        <div className="card">
          {allDone && (
            <div className="banner ok" role="status">
              <Ruby text="できたよ！1つずつ聞(き)いてみよう。" />
            </div>
          )}
          {/* 1行できるごとに増えていく（全部そろうのを待たない）。 */}
          {targets.map(({ comaIndex, line }) => (
            <LinePlayback key={line.id} comaIndex={comaIndex} line={line} />
          ))}
        </div>
      )}
    </div>
  )
}
