import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
// 整形は Prettier に一本化する。ESLint 側の整形系ルールを無効化して衝突を防ぐ。
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'off',

      // --- 層の境界を機械で守る ---------------------------------------
      // 依存の向きは常に内向き（ui → application → domain）。
      // 破ると気づかないうちに元の「UIがfetchを直接呼ぶ」形に戻るので、
      // レビューではなく lint で止める。
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/infrastructure/*'],
              message:
                'UI 層から infrastructure を直接使わないでください。ユースケースは application/ に置きます。',
            },
          ],
        },
      ],

      // 未使用は消す。ただし _ 始まりは意図的な無視として許す。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Promise の投げっぱなしを防ぐ（void を付けるか await する）。
      'no-void': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // domain 層は純粋に保つ。React も fetch も知らない。
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-*', '**/application/*', '**/infrastructure/*', '**/ui/*'],
              message: 'domain 層は何にも依存しません（標準の TypeScript だけ）。',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'domain 層は I/O を行いません。' },
        { name: 'localStorage', message: 'domain 層は I/O を行いません。' },
        { name: 'indexedDB', message: 'domain 層は I/O を行いません。' },
      ],
    },
  },

  // application 層は UI を知らない。
  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/ui/*'],
              message: 'application 層は UI を知りません（依存の向きは内向き）。',
            },
          ],
        },
      ],
    },
  },

  // インフラ層は境界そのものなので、上の UI 向け制限は適用しない。
  {
    files: ['src/infrastructure/**/*.ts', 'src/application/**/*.ts', 'src/main.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // テスト・スクリプトは緩める（層をまたいで検証するため）。
  {
    files: ['**/*.test.{ts,tsx}', 'scripts/**', 'src/test/**'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
      'no-console': 'off',
    },
  },

  // 最後に置くこと（他の設定の整形系ルールを打ち消す）。
  prettier,
)
