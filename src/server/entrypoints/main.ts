import { bootstrapServer } from '#/server/bootstrap.ts'
import { serverNodeLog } from '#/node/logger.ts'
import { resolveGoblinCommandEntry } from '#/server/terminal/g-command.ts'
import { resolvePtyWorkerEntry } from '#/server/terminal/pty-worker-entry.ts'

if (import.meta.main) {
  void bootstrapServer({
    ptyWorkerEntry: resolvePtyWorkerEntry(import.meta.dirname),
    gCommandEntry: resolveGoblinCommandEntry(import.meta.dirname),
  }).catch((error: unknown) => {
    serverNodeLog.fatal({ err: error }, 'failed to bootstrap embedded server')
    process.exitCode = 1
  })
}
