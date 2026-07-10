import { terminalLog } from '#/web/logger.ts'
import type { TerminalCreateOptions } from '#/web/components/terminal/types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import {
  showTerminalCreateErrorToast,
  terminalCreateErrorKey,
  type TerminalCreateTranslator,
} from '#/web/components/terminal/terminal-create-feedback.ts'
import { recordWorkspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { terminalWorkspacePaneTabProvider } from '#/web/workspace-pane/tab-providers.ts'
export type TerminalCreateCommandResult =
  { ok: true; terminalSessionId: string } | { ok: false; error: unknown; messageKey: string }

export type TerminalCreateCommandAdmission =
  | string
  | {
      terminalSessionId: string
      ownsCreate: boolean
    }

const TERMINAL_CREATE_CANCELED_MESSAGE = 'terminal create request canceled'

export async function runCreateTerminalTabCommand(input: {
  base: TerminalSessionBase
  createTerminal: (
    base: TerminalSessionBase,
    options?: TerminalCreateOptions,
  ) => Promise<TerminalCreateCommandAdmission>
  /**
   * The tab this creation should be attributed to (used for close-back focus
   * via the workspace pane tab opener tracker). Captured by the caller at
   * the user-action boundary because some creation paths do async pre-work
   * before entering the terminal view; their opener is the tab that initiated
   * the action, not whatever tab happens to be active when the async work
   * finishes.
   */
  openerIdentity: string | null
  /** Opens the concrete terminal route after the server has created a session. */
  showCreatedTerminalTab?: (terminalSessionId: string) => boolean | Promise<boolean>
  /**
   * Commits the workspace-pane tab/route state for the created session.
   * Workspace-pane callers use this to run the tab insertion and exact route
   * commit as one pane operation after terminal lifecycle admission resolves.
   */
  commitCreatedTerminalTab?: (terminalSessionId: string) => boolean | Promise<boolean>
  /**
   * Insertion anchor for the new terminal tab. Callers decide explicitly:
   * supply the captured opener's identity when the terminal is opened from
   * inside a specific tab (per Chrome-style opener rules), or omit for
   * generic entries (+ button, Cmd+T, Terminal menu) that should append.
   */
  options?: TerminalCreateOptions
  t?: TerminalCreateTranslator
  logMessage?: string
}): Promise<TerminalCreateCommandResult> {
  if (!input.base.repoRuntimeId) {
    return { ok: false, error: new Error('repo runtime unavailable'), messageKey: 'error.terminal-create-failed' }
  }
  try {
    const admission = terminalCreateCommandAdmission(await input.createTerminal(input.base, input.options))
    if (!admission.ownsCreate) return { ok: true, terminalSessionId: admission.terminalSessionId }
    return await finishCreateTerminalTabCommand(input, admission.terminalSessionId)
  } catch (error) {
    if (isTerminalCreateCanceled(error)) {
      return { ok: false, error, messageKey: 'error.terminal-create-failed' }
    }
    const messageKey = input.t ? showTerminalCreateErrorToast(error, input.t) : terminalCreateErrorKey(error)
    terminalLog.warn(input.logMessage ?? 'failed to create terminal', { err: error, messageKey })
    return { ok: false, error, messageKey }
  }
}

function terminalCreateCommandAdmission(admission: TerminalCreateCommandAdmission): {
  terminalSessionId: string
  ownsCreate: boolean
} {
  return typeof admission === 'string' ? { terminalSessionId: admission, ownsCreate: true } : admission
}

async function finishCreateTerminalTabCommand(
  input: {
    base: TerminalSessionBase
    openerIdentity: string | null
    showCreatedTerminalTab?: (terminalSessionId: string) => boolean | Promise<boolean>
    commitCreatedTerminalTab?: (terminalSessionId: string) => boolean | Promise<boolean>
  },
  terminalSessionId: string,
): Promise<TerminalCreateCommandResult> {
  if (input.openerIdentity) {
    recordWorkspacePaneTabOpener(
      input.base.repoRoot,
      input.base.branch,
      terminalWorkspacePaneTabProvider.identity(terminalSessionId),
      input.openerIdentity,
    )
  }
  const navigationAccepted = input.commitCreatedTerminalTab
    ? await input.commitCreatedTerminalTab(terminalSessionId)
    : input.showCreatedTerminalTab
      ? await input.showCreatedTerminalTab(terminalSessionId)
      : true
  if (!navigationAccepted) {
    return {
      ok: false,
      error: new Error('workspace pane navigation rejected'),
      messageKey: 'error.terminal-create-failed',
    }
  }
  return { ok: true, terminalSessionId }
}

function isTerminalCreateCanceled(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === TERMINAL_CREATE_CANCELED_MESSAGE || error.message === 'error.repo-runtime-stale')
  )
}
