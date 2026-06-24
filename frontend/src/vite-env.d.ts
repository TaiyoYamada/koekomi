/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GAS_URL?: string
  readonly VITE_SERVER_FRESH_SECONDS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
