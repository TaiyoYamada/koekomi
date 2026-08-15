import { defineConfig, devices } from '@playwright/test'

/**
 * E2E の設定。
 *
 * 本物のブラウザで、本物のバックエンド（ダミーTTS）に触る。
 * 単体テストが守れない「画面から通しで動くか」だけを見る。
 *
 *   npm run e2e          … 実行
 *   npm run e2e:ui       … 画面を見ながらデバッグ
 */
export default defineConfig({
  testDir: './e2e',
  // 子どもが1台のiPadで触るアプリなので、並列で状態を壊し合わないよう直列。
  // localStorage / IndexedDB / サーバー上の声を共有しているため。
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0, // フレーキーを再試行で隠さない。落ちたら直す。
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // マイクの許可を自動で与える（録音経路の確認に要る）。
    permissions: ['microphone'],
    locale: 'ja-JP',
  },

  projects: [
    {
      name: 'iPad',
      // 本番の端末に一番近いプロファイル。
      use: { ...devices['iPad (gen 7) landscape'] },
    },
  ],

  // フロントは Vite の dev サーバー。
  // 名簿とバックエンドは e2e/global-setup.ts が立てる。
  webServer: {
    command: 'npm run dev --workspace frontend',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      VITE_GAS_URL: 'http://127.0.0.1:8792/',
      VITE_EVENT_TOKEN: 'e2e-token',
    },
  },

  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
})
