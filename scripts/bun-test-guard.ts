#!/usr/bin/env bun
// Loaded by bunfig.toml's [test] preload.
// Goal: refuse `bun test` (Bun's built-in runner) and direct users to `bun run test` (Vitest).
const isVitest = process.env.VITEST === 'true' || process.env.VITEST_WORKER_ID !== undefined
if (isVitest) {
  // Defensive: if Vitest ever loads this file, let it proceed unchanged.
  process.exit(0)
}

console.error("[test] Don't use `bun test` — this project runs on Vitest.")
console.error("[test] Use `bun run test` (or `bun run test:watch` for watch mode).")
process.exit(1)