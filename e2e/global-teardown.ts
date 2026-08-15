// E2E のあと片付け。テストで作った声も生成物も残さない。

import { rm } from 'node:fs/promises'
import path from 'node:path'
import { ROOT } from './fixtures/server'

export default async function globalTeardown() {
  const held = (globalThis as Record<string, any>).__koekomi_e2e__
  held?.backend?.kill('SIGTERM')
  await new Promise<void>((resolve) => held?.registry?.close(() => resolve()) ?? resolve())
  await rm(path.join(ROOT, '.e2e-tmp'), { recursive: true, force: true })
}
