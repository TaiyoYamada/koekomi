import { useCallback, useEffect, useRef, useState } from 'react'
import { Ruby } from './Furigana'
import { useApp } from '../state'
import { fileUrl, generateComicVoices } from '../lib/api'
import { REFERENCE_SCRIPT } from '../lib/script'

// 録音直後の「お試し」用プリセット（タイプせずに押せる）。
// say   = 実際にAIに読み上げさせる文字（プレーン。API送信＆キャッシュキー）
// label = 画面表示（漢字＋ふりがな記法。Ruby で描画）
const PRESETS = [
  { say: 'こんにちは！', label: 'こんにちは！' },
  { say: 'ぼく・わたしの こえだよ', label: 'ぼく・わたしの 声(こえ)だよ' },
]

/** 録音した声で、決まった言葉をその場でAIに喋らせてみる（お試し）。
 *  本番の全セリフ生成（AI声セクション）とは別の、録音できたか確かめる即時フィードバック。
 *  録音できたら自動でプリセットを先読み生成しておくので、ボタンは押した瞬間に鳴る。 */
export function VoiceTryout() {
  const { assignment, recordingBlob, tryoutVoices, setTryoutVoice, beginGenerating, endGenerating } =
    useApp()
  const [preparing, setPreparing] = useState(false)
  const [prepError, setPrepError] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const apiUrl = assignment?.apiUrl ?? null
  const blob = recordingBlob

  /** 未キャッシュのプリセットを順番に先読み生成する。 */
  const prepare = useCallback(async () => {
    if (!apiUrl || !blob) return
    if (PRESETS.every((p) => tryoutVoices[p.say])) {
      setPreparing(false)
      return
    }
    setPreparing(true)
    setPrepError(false)
    beginGenerating() // お試しの先読みも生成の一種。生成中は録り直しを止める。
    try {
      for (const { say } of PRESETS) {
        if (tryoutVoices[say]) continue
        const res = await generateComicVoices(apiUrl, {
          audio: blob,
          referenceText: REFERENCE_SCRIPT,
          lines: [say],
        })
        const name = res.files[0]
        if (name) setTryoutVoice(say, fileUrl(apiUrl, name))
        else throw new Error('empty')
      }
    } catch {
      setPrepError(true)
    } finally {
      setPreparing(false)
      endGenerating()
    }
    // tryoutVoices は意図的に依存に入れない（生成のたびに再実行させないため）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, blob, setTryoutVoice])

  // 録音（またはサーバー）が変わったら自動で準備する。
  useEffect(() => {
    void prepare()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, blob])

  // 接続済み＋録音済みのときだけ出す（クローンに録音音声が要るため）。
  if (!assignment || !recordingBlob) return null

  function play(url: string) {
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

      {preparing && (
        <div className="rec-indicator" role="status">
          <div className="spinner" />
          <Ruby text="AIが あなたの声(こえ)を 覚(おぼ)えているよ…" />
        </div>
      )}
      {prepError && !preparing && (
        <div className="banner err">
          <Ruby text="じゅんびに しっぱいしたよ。" />
          <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => void prepare()}>
            <Ruby text="もう一度(いちど)じゅんび" />
          </button>
        </div>
      )}

      <div className="tryout-presets">
        {PRESETS.map((p) => {
          const url = tryoutVoices[p.say]
          return (
            <button
              key={p.say}
              className="btn secondary"
              disabled={!url}
              onClick={() => url && play(url)}
            >
              <Ruby text={p.label} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
