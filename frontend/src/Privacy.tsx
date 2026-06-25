import { useNavigate } from 'react-router-dom'

/** プライバシーポリシー（保護者・関係者向け。やさしく崩さず丁寧に記載）。 */
export function Privacy() {
  const navigate = useNavigate()
  return (
    <div className="admin">
      <button className="btn secondary" onClick={() => navigate('/')}>
        ← アプリに戻る
      </button>
      <h1>プライバシーポリシー</h1>

      <p>
        「コエコミ」（以下「本アプリ」）は、小学生向けイベントでの体験を目的とした
        Web アプリケーションです。本アプリにおける個人情報および音声データの取り扱いについて、
        以下のとおり定めます。
      </p>

      <div className="card">
        <h3>1. 運営者</h3>
        <ul>
          <li>氏名：山田大陽</li>
          <li>連絡先：t-yamada@ilab.pu-kumamoto.ac.jp</li>
        </ul>
      </div>

      <div className="card">
        <h3>2. 取得する情報</h3>
        <ul>
          <li>マイクで録音した音声（AI 音声生成の参照に使用）</li>
          <li>利用者が入力したセリフ等のテキスト</li>
          <li>各端末に割り当てたサーバー情報（接続先・色・サーバーID）</li>
        </ul>
        <p>氏名・住所・連絡先などの個人を特定する情報は取得しません。</p>
      </div>

      <div className="card">
        <h3>3. 利用目的</h3>
        <ul>
          <li>録音した声をもとに、4コマ作品のセリフを読み上げる AI 音声を生成するため</li>
          <li>作品をブラウザ上で再生（4コマ劇場）するため</li>
        </ul>
      </div>

      <div className="card">
        <h3>4. 音声データの取り扱い</h3>
        <ul>
          <li>
            AI 音声生成は、すべて運営者が用意した実行環境（Google Colab）
            <strong>内のみ</strong>で処理します。
          </li>
          <li>
            音声データを<strong>第三者（外部のクラウドサービス等）へ送信することはありません</strong>。
          </li>
          <li>
            録音音声および生成した音声は一時的に保存され、<strong>イベント終了後に削除</strong>します。
          </li>
          <li>各端末のブラウザに残るのは接続先情報のみで、音声やセリフは保存しません。</li>
        </ul>
      </div>

      <div className="card">
        <h3>5. 第三者提供</h3>
        <p>法令に基づく場合を除き、取得した情報を第三者へ提供することはありません。</p>
      </div>

      <div className="card">
        <h3>6. お問い合わせ</h3>
        <p>
          本ポリシーに関するお問い合わせは、上記運営者の連絡先（t-yamada@ilab.pu-kumamoto.ac.jp）
          までご連絡ください。
        </p>
      </div>

      <p className="step-hint">本ポリシーは、必要に応じて改定することがあります。</p>
    </div>
  )
}
