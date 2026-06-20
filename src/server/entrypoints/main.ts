import { bootstrapServer } from '#/server/bootstrap.ts'
import { resolveGoblinCommandEntry } from '#/server/terminal/g-command.ts'
import { resolvePtyWorkerEntry } from '#/server/terminal/pty-worker-entry.ts'

if (import.meta.main) {
  void bootstrapServer({
    ptyWorkerEntry: resolvePtyWorkerEntry(import.meta.dirname),
    gCommandEntry: resolveGoblinCommandEntry(import.meta.dirname),
  })
}
