import { terminalLog } from '#/web/logger.ts'
import type { TerminalCreateOptions } from '#/web/components/terminal/types.ts'
import type { TerminalCreateAction, TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneRuntimeTabPlacement } from '#/shared/workspace-pane-runtime.ts'
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
      requestRole: 'leader' | 'observer'
      resourceDisposition: TerminalCreateAction
      workspacePaneTabs?: WorkspacePaneTabEntry[]
    }

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
  commitCreatedTerminalTab?: (
    terminalSessionId: string,
    workspacePaneTabs: WorkspacePaneTabEntry[] | null,
  ) => boolean | Promise<boolean>
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
    const admission = terminalCreateCommandAdmission(
      input.insertAfterIdentity === undefined
        ? await input.createTerminal(input.base, input.options)
        : await input.createTerminal(input.base, input.options, {
            insertAfterIdentity: input.insertAfterIdentity,
          }),
    )
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

function terminalCreateCommandAdmission(admission: TerminalCreateCommandAdmission):
  | {
      terminalSessionId: string
      requestRole: 'leader'
      resourceDisposition: TerminalCreateAction
      workspacePaneTabs: WorkspacePaneTabEntry[] | null
    }
  | {
      terminalSessionId: string
      requestRole: 'observer'
      resourceDisposition: TerminalCreateAction
      workspacePaneTabs: WorkspacePaneTabEntry[] | null
    } {
  return typeof admission === 'string'
    ? { terminalSessionId: admission, requestRole: 'leader', resourceDisposition: 'created', workspacePaneTabs: null }
    : { ...admission, workspacePaneTabs: admission.workspacePaneTabs ?? null }
}

async function finishCreateTerminalTabCommand(
  input: {
    base: TerminalSessionBase
    openerIdentity: string | null
    showCreatedTerminalTab?: (terminalSessionId: string) => boolean | Promise<boolean>
    commitCreatedTerminalTab?: (
      terminalSessionId: string,
      workspacePaneTabs: WorkspacePaneTabEntry[] | null,
    ) => boolean | Promise<boolean>
  },
  admission: {
    terminalSessionId: string
    requestRole: 'leader'
    resourceDisposition: TerminalCreateAction
    workspacePaneTabs: WorkspacePaneTabEntry[] | null
  },
): Promise<TerminalCreateCommandResult> {
  const terminalSessionId = admission.terminalSessionId
  if (input.openerIdentity && admission.resourceDisposition === 'created') {
    recordWorkspacePaneTabOpener(
      input.base.repoRoot,
      input.base.branch,
      terminalWorkspacePaneTabProvider.identity(terminalSessionId),
      input.openerIdentity,
    )
  }
  const navigationAccepted = input.commitCreatedTerminalTab
    ? await input.commitCreatedTerminalTab(terminalSessionId, admission.workspacePaneTabs)
    : input.showCreatedTerminalTab
      ? await input.showCreatedTerminalTab(terminalSessionId)
      : true
  if (!navigationAccepted) {
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
