// Prefer the bundled worker, while allowing the source entry in source-only
// runs. Missing entries fail startup instead of spawning an unintended file.

import { existsSync } from 'node:fs'
import path from 'node:path'

export function resolvePtyWorkerEntry(dirname: string, fileExists: typeof existsSync = existsSync): string {
  const built = path.resolve(dirname, 'pty-worker.js')
  if (fileExists(built)) return built
  const source = path.resolve(dirname, 'pty-worker.ts')
  if (fileExists(source)) return source
  throw new Error(`PTY worker entry not found in ${dirname}`)
}
