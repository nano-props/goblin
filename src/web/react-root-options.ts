import type { createRoot } from 'react-dom/client'
import { bootstrapLog } from '#/web/logger.ts'
import { markReactRenderErrorLogged } from '#/web/react-error-logging.ts'

type ReactRootOptions = Parameters<typeof createRoot>[1]

interface ReactRootLogger {
  readonly error: (message: string, context: unknown) => void
  readonly warn: (message: string, context: unknown) => void
}

interface ReactRootOptionsInput {
  readonly dev?: boolean
  readonly log?: ReactRootLogger
  readonly markRenderErrorLogged?: (error: unknown) => boolean
}

export function reactRootOptions(input: ReactRootOptionsInput = {}): ReactRootOptions {
  const { dev = import.meta.env.DEV, log = bootstrapLog, markRenderErrorLogged = markReactRenderErrorLogged } = input
  if (dev) return undefined
  return {
    onUncaughtError(error, errorInfo) {
      if (markRenderErrorLogged(error)) return
      log.error('uncaught render error', { error, componentStack: errorInfo.componentStack })
    },
    onRecoverableError(error, errorInfo) {
      log.warn('recoverable render error', { error, componentStack: errorInfo.componentStack })
    },
  }
}
