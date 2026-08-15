// 本番と同じ経路を、本物のブラウザで通す。
//
// ここで守っているのは、**手で触って見つけた不具合**の再発:
//   - 停止中に字幕プレビューが出ない
//   - 作品が黙って消える（空の状態が保存を上書きする）
//   - 生成した音声が手元に残らない（サーバーが変わると壊れる）
//
// どれも単体テストでは捕まらなかった種類のもの。

import { expect, test, type Page } from '@playwright/test'

/** 3秒の wav（子どもが固定スクリプトを読んだ想定）。 */
function referenceWav(): Buffer {
  const rate = 16000
  const seconds = 3
  const samples = rate * seconds
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 200 * i) / rate)), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/** 前の子の痕跡を消してから始める。 */
async function freshStart(page: Page) {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    const dbs = (await indexedDB.databases?.()) ?? []
    await Promise.all(dbs.map((d) => d.name && indexedDB.deleteDatabase(d.name)))
  })
  await page.reload()
}

/**
 * 画面を切り替える。
 *
 * ふりがなは <ruby> で描くので、見えている文字はテキスト検索で割れる
 * （「録音」が「録音 ろくおん」になる）。だから **aria-label（素の名前）**
 * で掴む。これは支援技術が読む名前でもあるので、
 * 「テストが通る ＝ 読み上げも正しい」という関係になる。
 */
function nav(page: Page, name: '録音' | '編集' | 'AI声' | '劇場') {
  return page.getByRole('button', { name, exact: true })
}

/** タイトル画面から始めて、サーバーにつながるまで待つ。 */
async function startApp(page: Page) {
  await page.getByRole('button', { name: '作ってみよう', exact: true }).click()
  // つながると「接続されていません」が消える。
  await expect(page.locator('.status-pill.warn')).toBeHidden({ timeout: 20_000 })
}

/** 参照音声をファイルとして渡す（CI にマイクは無い）。 */
async function uploadVoice(page: Page) {
  await nav(page, '録音').click()
  await page.locator('input[type="file"][accept="audio/*"]').setInputFiles({
    name: 'reference.wav',
    mimeType: 'audio/wav',
    buffer: referenceWav(),
  })
}

/** 指定したコマにセリフを書く。 */
async function writeLine(page: Page, comaIndex: number, text: string) {
  const inputs = page.getByPlaceholder('ここに言葉を書く')
  await inputs.nth(comaIndex).fill(text)
}

/**
 * 保存が終わるのを待つ。
 *
 * 打鍵のたびに保存すると重いので 300ms のデバウンスを入れている。
 * 待たずにリロードすると「保存前に消えた」ことになり、
 * テストが実装のバグと区別できなくなる。
 */
async function waitForSaved(page: Page, text: string) {
  await page.waitForFunction(
    (needle) => (localStorage.getItem('koekomi.work.v3') ?? '').includes(needle),
    text,
    { timeout: 10_000 },
  )
}

/**
 * サーバーが1台も使えない状況を作る。
 *
 * 名簿だけ落としても足りない。保存済みの接続先があると、そちらの
 * `/health` が通ってしまい「つながっている」ままになるため
 * （実際そう書いて、テストが通らずに気づいた）。名簿とバックエンドの
 * 両方を落として、はじめて本当の全滅になる。
 */
async function cutAllServers(page: Page) {
  await page.route(/127\.0\.0\.1:879[12]/, (route) => route.abort())
}

test.describe('通しで作品を作る', () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page)
  })

  test('録音 → セリフ → AI音声 → 劇場 まで通る', async ({ page }) => {
    await startApp(page)

    // --- 1. 声を預ける（お試しが自動で走る） ---
    await uploadVoice(page)
    // 録音の再生バーが出る＝手元に取り込めた。
    await expect(page.locator('audio').first()).toBeVisible({ timeout: 15_000 })
    // お試しのボタンが押せる状態になる＝エンロールと生成が通った。
    await expect(page.getByRole('button', { name: 'こんにちは！' })).toBeEnabled({
      timeout: 60_000,
    })

    // --- 2. セリフを書く ---
    await nav(page, '編集').click()
    await writeLine(page, 0, 'おはよう')
    await writeLine(page, 1, 'いい てんきだね')

    // --- 3. AI音声を作る ---
    await nav(page, 'AI声').click()
    await page.getByRole('button', { name: '声を作る', exact: true }).click()
    await expect(page.locator('.banner.ok')).toBeVisible({ timeout: 90_000 })
    // 行ごとに再生バーが出る。
    await expect(page.locator('audio')).toHaveCount(2)

    // --- 4. 劇場で見る ---
    await nav(page, '劇場').click()
    // **停止中でも字幕のプレビューが出ること**（手で見つけた不具合の回帰）。
    await expect(page.locator('.theater-subtitle')).toHaveText('おはよう')

    await page.getByRole('button', { name: '再生', exact: true }).click()
    await expect(page.getByRole('button', { name: '止める', exact: true })).toBeVisible()
  })

  test('生成した音声は端末に残る（サーバーが変わっても壊れない）', async ({ page }) => {
    await startApp(page)
    await uploadVoice(page)
    await nav(page, '編集').click()
    await writeLine(page, 0, 'てすと')
    await nav(page, 'AI声').click()
    await page.getByRole('button', { name: '声を作る', exact: true }).click()
    await expect(page.locator('.banner.ok')).toBeVisible({ timeout: 90_000 })

    const stored = await page.evaluate(async () => {
      const saved = JSON.parse(localStorage.getItem('koekomi.work.v3') ?? 'null')
      const keys: string[] = await new Promise((resolve) => {
        const req = indexedDB.open('koekomi-audio', 1)
        req.onsuccess = () => {
          const q = req.result.transaction('audio', 'readonly').objectStore('audio').getAllKeys()
          q.onsuccess = () => resolve(q.result.map(String))
        }
        req.onerror = () => resolve([])
      })
      return { keys, raw: JSON.stringify(saved) }
    })

    // 音声の実体が手元にある。
    expect(stored.keys).toContain('reference')
    expect(stored.keys.some((k) => k.startsWith('l'))).toBe(true)
    // **保存データに絶対URLが1文字も入っていない**
    // （入っていると、トンネルが変わった瞬間に作品が静かに壊れる）。
    expect(stored.raw).not.toContain('http')
  })
})

test.describe('作品が消えない', () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page)
  })

  test('リロードしても写真とセリフが残る', async ({ page }) => {
    await startApp(page)
    await nav(page, '編集').click()

    // 写真を選ぶ（コマの写真ボタン）。
    await page.locator('.coma-photo').first().click()
    await page.locator('.panel-grid button').first().click()
    await writeLine(page, 0, 'のこってね')
    await waitForSaved(page, 'のこってね')

    await page.reload()
    await expect(page.getByPlaceholder('ここに言葉を書く').first()).toHaveValue('のこってね')
    await expect(page.locator('.coma-photo.has-photo img').first()).toBeVisible()
  })

  test('何度リロードしても消えない（空の状態が上書きしない）', async ({ page }) => {
    await startApp(page)
    await nav(page, '編集').click()
    await writeLine(page, 0, 'きえないで')
    await waitForSaved(page, 'きえないで')

    for (let i = 0; i < 3; i++) {
      await page.reload()
      await expect(page.getByPlaceholder('ここに言葉を書く').first()).toHaveValue('きえないで')
    }
  })
})

test.describe('フォールバック', () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page)
  })

  test('サーバーにつながらないとき、逃げ道が出る', async ({ page }) => {
    await cutAllServers(page)
    await page.reload()
    await page.getByRole('button', { name: '作ってみよう', exact: true }).click()

    await expect(page.locator('.status-pill.warn')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.banner.err')).toBeVisible()
  })

  test('読み上げモードに切り替えると、サーバー無しで劇場まで行ける', async ({ page }) => {
    await cutAllServers(page)
    await page.reload()
    await page.getByRole('button', { name: '作ってみよう', exact: true }).click()
    await expect(page.locator('.banner.err')).toBeVisible({ timeout: 20_000 })
    // 失敗バナーの3つ目が「読み上げモード」。
    await page.locator('.banner.err button').nth(2).click()

    // 読み上げモードは「編集」と「劇場」だけになる。
    await expect(nav(page, '録音')).toHaveCount(0)
    await writeLine(page, 0, 'よみあげ')
    await nav(page, '劇場').click()
    await expect(page.locator('.theater-subtitle')).toHaveText('よみあげ')
  })
})

test.describe('先生用画面', () => {
  test('全台の状態が見える', async ({ page }) => {
    await freshStart(page)
    await page.goto('/admin')

    await expect(page.getByRole('heading', { name: 'サーバーの状態' })).toBeVisible()
    await expect(page.getByRole('cell', { name: /e2e-server/ })).toBeVisible({ timeout: 20_000 })
    // ダミーTTS なので警告が出るのが正しい。
    await expect(page.getByText('⚠️ dummy')).toBeVisible()
  })
})

test.describe('アクセシビリティ', () => {
  test('進行状況が読み上げ対象になっている', async ({ page }) => {
    await freshStart(page)
    await startApp(page)
    await uploadVoice(page)

    // お試しの準備中は role=status で伝える。
    const live = page.locator('[role="status"], [aria-live]')
    await expect(live.first()).toBeAttached()
  })
})
