import { app, dialog } from 'electron'
import { t } from '#/main/i18n/index.ts'
import { serverNodeLog } from '#/node/logger.ts'

const STDERR_DIALOG_MAX_CHARS = 2_000

export interface UnexpectedEmbeddedServerExit {
  pid: number | undefined
  code: number | null
  signal: NodeJS.Signals | null
  stderrTail: string
}

/**
 * Native-host fatal boundary for an embedded server that died after becoming
 * ready. Recovery is deliberately not attempted: continuing would leave the
 * client running against missing server-owned state and could hide the fault
 * that terminated the authoritative process.
 */
export function failNativeHostForUnexpectedServerExit(exit: UnexpectedEmbeddedServerExit): void {
  const exitDetail = exit.signal ? `signal ${exit.signal}` : `exit code ${exit.code ?? 'unknown'}`
  const trimmedStderr = exit.stderrTail.trim()
  serverNodeLog.fatal(
    {
      pid: exit.pid,
      code: exit.code,
      signal: exit.signal,
      stderrTail: trimmedStderr || undefined,
    },
    'embedded server exited unexpectedly',
  )
  const dialogStderr =
    trimmedStderr.length <= STDERR_DIALOG_MAX_CHARS
      ? trimmedStderr
      : `…${trimmedStderr.slice(trimmedStderr.length - STDERR_DIALOG_MAX_CHARS)}`
  const title = t('embedded-server.fatal-exit.title')
  const message = dialogStderr
    ? t('embedded-server.fatal-exit.body-with-detail', { exitDetail, stderr: dialogStderr })
    : t('embedded-server.fatal-exit.body', { exitDetail })
  try {
    dialog.showErrorBox(title, message)
  } finally {
    app.exit(1)
  }
}
