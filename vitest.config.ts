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
    // 10s per test. Most of the suite finishes in milliseconds; the
    // ceiling is for the rare test that starts a real timer / IPC
    // and would otherwise hang the worker indefinitely. Keep it tight
    // enough that a regression in test plumbing fails fast rather
    // than tying up the whole `bun run test` invocation.
    testTimeout: 10_000,
    // Vitest setupFiles run before user test code in every worker. Holds:
    //   - the Node `--localstorage-file` warning filter
    //   - the localStorage / sessionStorage shim that Zustand persist relies on
    // See `./vitest.setup.ts` for the rationale of each entry.
    setupFiles: ['./vitest.setup.ts'],
  },
})
