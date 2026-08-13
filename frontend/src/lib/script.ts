// 声クローンの参照用に読んでもらう固定スクリプト（子どもがゆっくり読んで約8〜10秒）。
// この文をそのまま reference_text として送るので、音声を文字に変換する処理は不要。
// 全部ひらがなで、空欄なし（音声と文字が必ず一致するように可変部分を入れない）。
export const REFERENCE_SCRIPT =
  'きょうは とても いい てんきです。ちいさな ねこが おそとへ でかけました。ねこは うれしくて、げんきに うたを うたいました。'

// 画面に出すときは「。」のうしろで改行して読みやすくする（送る reference_text は元のまま）。
// 後読み正規表現 /(?<=。)/ は iOS 16.4 未満の Safari で構文エラーになり
// アプリごと真っ白になるため使わない（学校の古い iPad が対象に入る）。
const SCRIPT_PARTS = REFERENCE_SCRIPT.split('。')
export const REFERENCE_SCRIPT_LINES = SCRIPT_PARTS
  // split で消えた「。」を最後の断片以外に戻す。
  .map((s, i) => (i < SCRIPT_PARTS.length - 1 ? s + '。' : s))
  .filter((s) => s.trim() !== '')
