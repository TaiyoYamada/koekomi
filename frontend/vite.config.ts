import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// iPad（同一LAN / トンネル経由）から確認できるように host を開放する。
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // 0.0.0.0 で待ち受け。LAN やトンネルから到達できる。
    port: 5173,
    // 外部の動的ホスト名を許可する（開発中の iPad 確認用）。
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 5173,
    allowedHosts: true,
  },
})
