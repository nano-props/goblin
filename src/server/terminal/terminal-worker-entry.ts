import { existsSync } from 'node:fs'
import path from 'node:path'

export function resolveTerminalWorkerEntry(dirname: string, fileExists: typeof existsSync = existsSync): string {
  const built = path.resolve(dirname, 'terminal-worker.js')
  if (fileExists(built)) return built
  const source = path.resolve(dirname, 'terminal-worker.ts')
  if (fileExists(source)) return source
  throw new Error(`Terminal worker entry not found in ${dirname}`)
}
