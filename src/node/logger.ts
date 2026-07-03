// Node-side logger (Electron main, preload, system utilities).
//
// Mirrors `src/web/logger.ts` for symmetry: one pino instance with tagged
// children. The Hono server already has `serverLogger` in
// `src/server/logger.ts`, which is kept as a thin re-export of this
// module — keeping the established `serverLogger` import path working
// across `src/server/*` while collapsing the configuration to one place.
//
// Level policy (matches `src/server/logger.ts`):
//   - Test runs: Silent. `bun run test` runs under NODE_ENV=test, and
//     pino's `silent` level drops every record at the source so the
//     test output stays free of stack frames that aren't failures.
//   - Production: Info. Captures lifecycle events (server boot, IPC
//     failures, persistence errors) without debug noise.
//   - Dev: Info. Captures lifecycle events; debug records are reachable
//     by setting GOBLIN_NODE_LOG_LEVEL=debug explicitly.
//
// Tagged children are pre-bound to the same tag prefixes the codebase
// already uses (`[server]`, `[window]`, `[menu]`, etc.), so call sites
// stay one symbol:
//   `nodeLog.child({ tag: 'window' }).warn({ err }, 'failed to load')`
//   renders as `{"level":"warn","tag":"window","msg":"failed to load", ...}`.

import { pino, type Logger } from 'pino'
import { installStdioErrorGuard } from '#/node/stdio-error-guard.ts'

type NodeLogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'

// The Electron main process inherits stdio from dev terminals such as Ghostty.
// If that PTY disappears first, later log writes can emit EIO/EBADF/EPIPE; a
// disconnected log sink should not crash the app.
installStdioErrorGuard()

function resolveNodeLogLevel(): NodeLogLevel {
  const envLevel = process.env.GOBLIN_NODE_LOG_LEVEL?.trim()
  if (
    envLevel === 'fatal' ||
    envLevel === 'error' ||
    envLevel === 'warn' ||
    envLevel === 'info' ||
    envLevel === 'debug' ||
    envLevel === 'trace' ||
    envLevel === 'silent'
  ) {
    return envLevel
  }
  return process.env.NODE_ENV === 'test' ? 'silent' : 'info'
}

export const nodeLogger: Logger = pino({
  name: 'goblin-node',
  level: resolveNodeLogLevel(),
  timestamp: pino.stdTimeFunctions.isoTime,
})

// Pre-tagged child loggers. Each subsystem imports the variant it needs;
// call sites stay one symbol:
//   `serverNodeLog.warn({ err }, 'failed to start')`
//   renders as `{"tag":"server","msg":"failed to start", ...}`.
export const serverNodeLog = nodeLogger.child({ tag: 'server' })
export const windowNodeLog = nodeLogger.child({ tag: 'window' })
export const windowStateNodeLog = nodeLogger.child({ tag: 'window-state' })
export const clientSurfaceRegistryNodeLog = nodeLogger.child({ tag: 'client-surface-registry' })
export const menuNodeLog = nodeLogger.child({ tag: 'menu' })
export const themeNodeLog = nodeLogger.child({ tag: 'theme' })
export const shortcutsNodeLog = nodeLogger.child({ tag: 'shortcuts' })
export const terminalNodeLog = nodeLogger.child({ tag: 'terminal' })
export const clientNodeLog = nodeLogger.child({ tag: 'client' })
export const ghosttyNodeLog = nodeLogger.child({ tag: 'ghostty' })
export const pullRequestsNodeLog = nodeLogger.child({ tag: 'pull-requests' })
export const serverRepoNodeLog = nodeLogger.child({ tag: 'server-repo' })
export const i18nNodeLog = nodeLogger.child({ tag: 'i18n' })
export const accessTokenNodeLog = nodeLogger.child({ tag: 'access-token' })
