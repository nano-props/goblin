import path from 'node:path'
import { serverLogger } from '#/server/logger.ts'
import { launchStandaloneServer } from '#/server/standalone/standalone-launch.ts'

if (import.meta.main) {
  // This entry is bundled directly into dist/standalone-server. Keeping the
  // layout explicit prevents it from probing or reusing Electron artifacts.
  void launchStandaloneServer({
    repoRoot: path.resolve(import.meta.dirname, '../..'),
    runtimeEntryDir: import.meta.dirname,
  }).catch((error: unknown) => {
    serverLogger.fatal({ err: error }, 'failed to launch standalone server')
    process.exitCode = 1
  })
}
