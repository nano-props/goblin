import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Two projects, one per environment:
//   - `node` (default) covers everything outside the web tree
//     (`src/main`, `src/server`, `src/shared`, `src/system`, and the
//     top-level `src/check-ls.test.ts`). It is the cheap project — no
//     DOM, no `ResizeObserver` shim, no `window`. Baseline `environment`
//     was 38s because the jsdom startup was paid even when the worker
//     was running a node-only file. Splitting by environment removes
//     that overhead from server/shared runs.
//   - `jsdom` covers `src/web/**`. Files there already declare
//     `// @vitest-environment jsdom`; the directive still wins when
//     present, but the project default is now also `jsdom`, which
//     means files that omitted the directive also run under jsdom
//     when collected by this project — this matches the previous
//     behavior of the single project.
//
// Both projects share the alias map and the global `setupFiles`. They
// each set their own `include` glob so vitest never has to ask a
// worker to load a jsdom setup file just to run a node test (or
// vice versa).

const alias = {
  '#': path.resolve(import.meta.dirname, 'src'),
}

const sharedTestOptions = {
  mockReset: true,
  restoreMocks: true,
  // 10s per test. Most of the suite finishes in milliseconds; the
  // ceiling is for the rare test that starts a real timer / IPC
  // and would otherwise hang the worker indefinitely. Keep it tight
  // enough that a regression in test plumbing fails fast rather
  // than tying up the whole `bun run test` invocation.
  testTimeout: 10_000,
  setupFiles: ['./vitest.setup.ts'],
}

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        test: {
          ...sharedTestOptions,
          name: 'node',
          environment: 'node',
          include: [
            'src/main/**/*.test.ts',
            'src/main/**/*.test.tsx',
            'src/server/**/*.test.ts',
            'src/server/**/*.test.tsx',
            'src/shared/**/*.test.ts',
            'src/shared/**/*.test.tsx',
            'src/system/**/*.test.ts',
            'src/system/**/*.test.tsx',
            'src/check-ls.test.ts',
            // Cross-cutting helpers under `src/test-utils/` and
            // `src/web/test-utils/` run under the `node` project because
            // they do not need DOM. They are intentionally excluded from
            // the jsdom project so they are not executed twice.
            'src/test-utils/**/*.test.ts',
            'src/test-utils/**/*.test.tsx',
            'src/web/test-utils/**/*.test.ts',
            'src/web/test-utils/**/*.test.tsx',
          ],
        },
      },
      {
        test: {
          ...sharedTestOptions,
          name: 'jsdom',
          environment: 'jsdom',
          // Only the web app/tests tree; helper modules under
          // `src/test-utils/` and `src/web/test-utils/` live in the
          // `node` project so we don't run them twice.
          include: ['src/web/**/*.test.ts', 'src/web/**/*.test.tsx'],
          exclude: ['src/web/test-utils/**', 'src/test-utils/**'],
        },
      },
    ],
  },
})
