import { useNavigate } from 'react-router-dom'
import { Ruby } from './components/Furigana'
import { Icon } from './components/icons'
import type { IconName } from './components/icons'

const STEPS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'mic',
    title: '録音(ろくおん)',
    body: '画面(がめん)に出(で)てくる文(ぶん)を、声(こえ)に出(だ)して読(よ)んでね。その声(こえ)をAIが覚(おぼ)えるよ。',
  },
  {
    icon: 'sparkles',
    title: 'お試(ため)し',
    body: 'ボタンを押(お)すと、自分(じぶん)のAIの声(こえ)で喋(しゃべ)るよ。うまくできたか聞(き)いてみよう。',
  },
  {
    icon: 'edit',
    title: '編集(へんしゅう)',
    body: '写真(しゃしん)を選(えら)んで、セリフを書(か)こう。コマやセリフの順番(じゅんばん)も変(か)えられるよ。',
  },
  {
    icon: 'film',
    title: 'AI声(こえ)',
    body: '書(か)いたセリフを、全部(ぜんぶ)自分(じぶん)の声(こえ)にしてもらおう。',
  },
  {
    icon: 'play',
    title: '4コマ劇場(げきじょう)',
    body: '出来上(できあ)がった4コマを、最後(さいご)まで 続(つづ)けて 見(み)てみよう。1コマずつ めくることもできるよ！',
  },
]

/** あそびかた（子ども向け。アプリの流れをやさしく説明）。 */
export function HowToPlay() {
  const navigate = useNavigate()
  return (
    <div className="admin">
      <button className="btn secondary" onClick={() => navigate('/')}>
        ← <Ruby text="アプリに戻(もど)る" />
      </button>
      <h1>
        <Ruby text="遊(あそ)び方(かた)" />
      </h1>

      <p className="step-hint">
        <Ruby text="自分(じぶん)の声(こえ)で喋(しゃべ)る4コマ劇場(げきじょう)を作(つく)ろう！ 順番(じゅんばん)は次(つぎ)の通(とお)りだよ。" />
      </p>

      <ol className="howto-list">
        {STEPS.map((s, i) => (
          <li key={s.title} className="howto-step">
            <span className="howto-no">{i + 1}</span>
            <span className="howto-ic">
              <Icon name={s.icon} size={26} />
            </span>
            <span className="howto-text">
              <strong>
                <Ruby text={s.title} />
              </strong>
              <span>
                <Ruby text={s.body} />
              </span>
            </span>
          </li>
        ))}
      </ol>

      <p className="step-hint">
        <Ruby text="どの順番(じゅんばん)でも、左(ひだり)のボタンでいつでも移(うつ)れるよ。" />
      </p>
    </div>
  )
}
