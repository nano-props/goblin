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
    // Vitest setupFiles run before user test code in every worker. Holds:
    //   - the Node `--localstorage-file` warning filter
    //   - the localStorage / sessionStorage shim that Zustand persist relies on
    // See `./vitest.setup.ts` for the rationale of each entry.
    setupFiles: ['./vitest.setup.ts'],
  },
})
