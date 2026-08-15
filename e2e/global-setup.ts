// E2E の前に、偽の名簿と本物のバックエンドを立てる。

import { rm } from 'node:fs/promises'
import path from 'node:path'
import { BACKEND_PORT, ROOT, startBackend, startRegistry, waitForHealth } from './fixtures/server'

export default async function globalSetup() {
  // 前回の残りを消す（前の子の声が残っていない状態から始める）。
  await rm(path.join(ROOT, '.e2e-tmp'), { recursive: true, force: true })

  const registry = await startRegistry(`http://127.0.0.1:${BACKEND_PORT}`)
  const backend = startBackend()
  await waitForHealth()

  // teardown で止められるように控えておく。
  ;(globalThis as Record<string, unknown>).__koekomi_e2e__ = { registry, backend }
}
