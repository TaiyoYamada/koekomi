// E2E 用の足場。
//
// 本番の構成をそのまま小さくしたものを立てる:
//   - 偽の名簿（GAS の代わり。CORS 付きで servers 一覧を返すだけ）
//   - 本物のバックエンド（ダミーTTS。GPU も外部通信も要らない）
//   - Vite の dev サーバー（Playwright の webServer が起動する）
//
// 「モックした世界」ではなく **本物のバックエンドに本物のブラウザから**
// 触るのが目的。手で見つけた不具合（字幕が出ない・作品が消える）は、
// この経路でしか捕まらない。

import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import path from 'node:path'

// Playwright はリポジトリ直下から動く（playwright.config.ts の位置）。
export const ROOT = process.cwd()

export const EVENT_TOKEN = 'e2e-token'
export const BACKEND_PORT = 8791
export const REGISTRY_PORT = 8792

/** 偽の名簿。GAS の `?action=list` と同じ形を返す。 */
export function startRegistry(apiUrl: string): Promise<Server> {
  const server = createServer((_req, res) => {
    const body = JSON.stringify({
      servers: [
        {
          serverId: 'e2e-server',
          color: 'red',
          label: '赤サーバー',
          apiUrl,
          enabled: true,
          lastSeen: Date.now(),
        },
      ],
    })
    res.writeHead(200, {
      'Content-Type': 'application/json',
      // フロント（別ポート）から読めるように。
      'Access-Control-Allow-Origin': '*',
    })
    res.end(body)
  })
  return new Promise((resolve) => server.listen(REGISTRY_PORT, '127.0.0.1', () => resolve(server)))
}

/** 本物のバックエンド（ダミーTTS）。 */
export function startBackend(): ChildProcess {
  const python = existsSync(path.join(ROOT, 'backend/.venv/bin/python'))
    ? path.join(ROOT, 'backend/.venv/bin/python')
    : 'python3'

  const child = spawn(
    python,
    ['-m', 'uvicorn', 'app.main:app', '--port', String(BACKEND_PORT), '--log-level', 'warning'],
    {
      cwd: path.join(ROOT, 'backend'),
      env: {
        ...process.env,
        TTS_BACKEND: 'dummy',
        EVENT_TOKEN,
        // フロントは 5173。写真の取得元でもある。
        FRONTEND_ORIGIN: 'http://127.0.0.1:5173',
        CORS_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173',
        // テストごとに消えるよう、一時ディレクトリに置く。
        ARTIFACT_DIR: path.join(ROOT, '.e2e-tmp/artifacts'),
        TMP_DIR: path.join(ROOT, '.e2e-tmp/tmp'),
        CACHE_DIR: path.join(ROOT, '.e2e-tmp/cache'),
      },
      stdio: 'pipe',
    },
  )
  child.stderr?.on('data', (b) => {
    const line = String(b)
    if (line.includes('ERROR') || line.includes('Traceback')) process.stderr.write(line)
  })
  return child
}

export async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/health`)
      if (res.ok && (await res.json()).status === 'ok') return
    } catch {
      // まだ起動していない
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('バックエンドが起動しませんでした')
}
