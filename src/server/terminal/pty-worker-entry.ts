// Resolves the on-disk path of the bundled PTY worker entry. The host
// process (or a test harness) calls this once at startup to find the
// file to spawn. Resolution order:
//   1. The bundled dist artifact (`pty-worker.js` next to the main
//      server bundle) — the production path.
//   2. The source entry (`pty-worker.ts` next to `pty-worker.js`) —
//      used during `bun run start:server` and other source-only runs.
//
// Throws if neither exists so startup fails loudly rather than
// silently falling back to a wrong file.

import { existsSync } from 'node:fs'
import path from 'node:path'

export function resolvePtyWorkerEntry(dirname: string, fileExists: typeof existsSync = existsSync): string {
  const built = path.resolve(dirname, 'pty-worker.js')
  if (fileExists(built)) return built
  const source = path.resolve(dirname, 'pty-worker.ts')
  if (fileExists(source)) return source
  throw new Error(`PTY worker entry not found in ${dirname}`)
}
