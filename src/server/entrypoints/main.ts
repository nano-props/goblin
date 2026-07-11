import { bootstrapServer } from '#/server/bootstrap.ts'
import { serverLogger } from '#/server/logger.ts'
import { resolveGoblinCommandEntry } from '#/server/terminal/g-command.ts'
import { resolvePtyWorkerEntry } from '#/server/terminal/pty-worker-entry.ts'

if (import.meta.main) {
  void bootstrapServer({
    ptyWorkerEntry: resolvePtyWorkerEntry(import.meta.dirname),
    gCommandEntry: resolveGoblinCommandEntry(import.meta.dirname),
  }).catch((error: unknown) => {
    serverLogger.fatal({ err: error }, 'failed to bootstrap embedded server')
    process.exitCode = 1
  })
}
