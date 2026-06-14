import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '#': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    mockReset: true,
    restoreMocks: true,
    // Load `scripts/test-suppress.cjs` in every worker fork. It runs at
    // process startup, before user test code, so it can:
    //   - silence process-level warnings (--localstorage-file, sourcemap,
    //     jsdom "Not implemented")
    //   - install a localStorage / sessionStorage shim so Zustand persist
    //     middleware never sees a half-stubbed `globalThis.localStorage`
    //   - stub HTMLCanvasElement.getContext and Window.focus so xterm and
    //     focus-restore tests do not log to stderr
    execArgv: ['--require', path.resolve(import.meta.dirname, 'scripts/test-suppress.cjs')],
  },
})
