// Shared structured logger for Electron, server, and system code.

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

// Subsystems import a pre-tagged child so ownership is present on every record.
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
