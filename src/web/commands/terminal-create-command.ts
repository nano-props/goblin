import { terminalLog } from '#/web/logger.ts'
import type { TerminalCreateOptions } from '#/web/components/terminal/types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabPlacement } from '#/shared/workspace-pane-runtime.ts'
import type {
  TerminalCreateAdmissionResult,
  TerminalCreateLeaderAdmissionResult,
} from '#/web/components/terminal/terminal-create-admission.ts'
import {
  showTerminalCreateErrorToast,
  terminalCreateErrorKey,
  type TerminalCreateTranslator,
} from '#/web/components/terminal/terminal-create-feedback.ts'
export type TerminalCreateCommandResult =
  { ok: true; terminalSessionId: string } | { ok: false; error: unknown; messageKey: string }

export type TerminalCreateCommandAdmission = TerminalCreateAdmissionResult

export type TerminalCreatedTabCommitResult =
  | { status: 'committed' }
  | { status: 'superseded' }
  | { status: 'projection-failed' }
  | { status: 'navigation-rejected' }

const TERMINAL_CREATE_CANCELED_MESSAGE = 'terminal create request canceled'
const WORKSPACE_PANE_NAVIGATION_REJECTED_MESSAGE = 'workspace pane navigation rejected'

export async function runCreateTerminalTabCommand(input: {
  base: TerminalSessionBase
  createTerminal: (
    base: TerminalSessionBase,
    options?: TerminalCreateOptions,
    placement?: WorkspacePaneRuntimeTabPlacement,
  ) => Promise<TerminalCreateCommandAdmission>
  /**
   * Applies the server projection and commits the exact route for the created
   * session. This is required so every leader request has one explicit
   * presentation boundary after server admission.
   */
  commitCreatedTerminalTab: (
    admission: TerminalCreateLeaderAdmissionResult,
  ) => TerminalCreatedTabCommitResult | Promise<TerminalCreatedTabCommitResult>
  /**
   * Insertion anchor for the new terminal tab. Callers decide explicitly:
   * supply the captured opener's identity when the terminal is opened from
   * inside a specific tab (per Chrome-style opener rules), or omit for
   * generic entries (+ button, Cmd+T, Terminal menu) that should append.
   */
  options?: TerminalCreateOptions
  insertAfterIdentity?: string | null
  t?: TerminalCreateTranslator
  logMessage?: string
}): Promise<TerminalCreateCommandResult> {
  if (!input.base.repoRuntimeId) {
    return { ok: false, error: new Error('repo runtime unavailable'), messageKey: 'error.terminal-create-failed' }
  }
  try {
    const admission =
      input.insertAfterIdentity === undefined
        ? await input.createTerminal(input.base, input.options)
        : await input.createTerminal(input.base, input.options, {
            insertAfterIdentity: input.insertAfterIdentity,
          })
    if (admission.requestRole === 'observer') return { ok: true, terminalSessionId: admission.terminalSessionId }
    return await finishCreateTerminalTabCommand(input, admission)
  } catch (error) {
    if (isTerminalCreateCanceled(error)) {
      return { ok: false, error, messageKey: 'error.terminal-create-failed' }
    }
    const messageKey = input.t ? showTerminalCreateErrorToast(error, input.t) : terminalCreateErrorKey(error)
    terminalLog.warn(input.logMessage ?? 'failed to create terminal', { err: error, messageKey })
    return { ok: false, error, messageKey }
  }
}

async function finishCreateTerminalTabCommand(
  input: {
    base: TerminalSessionBase
    commitCreatedTerminalTab: (
      admission: TerminalCreateLeaderAdmissionResult,
    ) => TerminalCreatedTabCommitResult | Promise<TerminalCreatedTabCommitResult>
  },
  admission: TerminalCreateLeaderAdmissionResult,
): Promise<TerminalCreateCommandResult> {
  const terminalSessionId = admission.terminalSessionId
  const presentationStatus = (await input.commitCreatedTerminalTab(admission)).status
  if (presentationStatus === 'navigation-rejected') {
    return {
      ok: false,
      error: new Error(WORKSPACE_PANE_NAVIGATION_REJECTED_MESSAGE),
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
