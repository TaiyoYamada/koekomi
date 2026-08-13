import { Ruby } from '../components/Furigana'
import { Mascot } from '../components/Mascot'
import { usePanels } from '../hooks/usePanels'

/**
 * 起動時のホーム（タイトル）画面。
 * 机の上に原稿が散らばっていて、その手前に題字のコマが置いてある、という見立て。
 * マスコットはコマの外にはみ出す（マンガのコマ抜け）。
 */
export function Home({ onStart }: { onStart: () => void }) {
  // 散らばった紙には、実際にこのあと選ぶ写真を載せる。
  // 空の白紙だと「散らかっている」だけで、何の情報も持たないため。
  const { panels } = usePanels()
  // 先頭から5枚だと似た絵ばかりになるので、間隔をあけて拾う。
  const sheets = [0, 5, 10, 15, 20].map((i) => panels[i]).filter(Boolean)

  return (
    <div className="home">
      {/* 机に散らばった原稿。これから4コマを描く場所であることを示す。 */}
      <div className="home-scatter" aria-hidden>
        {['s1', 's2', 's3', 's4', 's5'].map((pos, i) => (
          <span className={`sheet ${pos}`} key={pos}>
            {sheets[i] && <img src={sheets[i].src} alt="" />}
          </span>
        ))}
      </div>

      <div className="home-frame">
        {/* 集中線。マンガで「注目」を表す記号。読み上げ対象にはしない。 */}
        <div className="home-focus-lines" aria-hidden />

        <div className="home-inner">
          <Mascot />
          <h1 className="home-title">コエコミ</h1>
          <p className="home-tagline">
            <Ruby text="自分(じぶん)の声(こえ)で 4コマ劇場(げきじょう)を 作(つく)ろう！" />
          </p>

          <button className="btn big home-start" onClick={onStart}>
            <Ruby text="作(つく)ってみよう！" />
          </button>
        </div>
      </div>
    </div>
  )
}
