import type { Writable } from 'node:stream'

const STDIO_ERROR_GUARD = Symbol.for('goblin.stdioErrorGuardInstalled')

type GuardedProcess = NodeJS.Process & { [STDIO_ERROR_GUARD]?: boolean }

export function installStdioErrorGuard(processLike: NodeJS.Process = process): void {
  const guardedProcess = processLike as GuardedProcess
  if (guardedProcess[STDIO_ERROR_GUARD]) return
  guardedProcess[STDIO_ERROR_GUARD] = true
  attachRecoverableStdioErrorHandler(processLike.stdout)
  attachRecoverableStdioErrorHandler(processLike.stderr)
}

export function attachRecoverableStdioErrorHandler(stream: Writable): void {
  stream.on('error', (err) => {
    if (isRecoverableStdioWriteError(err)) return
    throw err
  })
}

export function isRecoverableStdioWriteError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  return code === 'EIO' || code === 'EBADF' || code === 'EPIPE'
}
