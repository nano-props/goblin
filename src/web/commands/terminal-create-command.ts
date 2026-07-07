import { terminalLog } from '#/web/logger.ts'
import type { TerminalCreateOptions } from '#/web/components/terminal/types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import {
  showTerminalCreateErrorToast,
  terminalCreateErrorKey,
  type TerminalCreateTranslator,
} from '#/web/components/terminal/terminal-create-feedback.ts'
import { recordWorkspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { terminalWorkspacePaneTabProvider } from '#/web/components/workspace-pane/tab-providers.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { hasFreshRepoInstance, repoInstanceHandle } from '#/web/stores/repos/repo-guards.ts'
import type { TerminalCreateOwner } from '#/web/components/terminal/types.ts'
import { createWorkspacePaneTerminalTab } from '#/web/workspace-pane/workspace-pane-terminal-create.ts'

export type TerminalCreateCommandResult =
  { ok: true; terminalSessionId: string } | { ok: false; error: unknown; messageKey: string }

const TERMINAL_CREATE_CANCELED_MESSAGE = 'terminal create request canceled'

export async function runCreateTerminalTabCommand(input: {
  base: TerminalSessionBase
  createTerminal: (base: TerminalSessionBase, options?: TerminalCreateOptions) => Promise<string>
  createOwnedTerminal?: (
    base: TerminalSessionBase,
    owner: TerminalCreateOwner,
    options?: TerminalCreateOptions,
  ) => Promise<string>
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
  showCreatedTerminalTab?: (terminalSessionId: string) => void | Promise<void>
  /** Prevents late terminal creation from stealing focus after the user navigates away. */
  shouldShowCreatedTerminalTab?: () => boolean
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
  const repoInstance = repoInstanceHandle(useReposStore.getState().repos[input.base.repoRoot])
  const owner = createTerminalCreateOwner(repoInstance)
  const usesOwnedCreate = !!(owner && input.createOwnedTerminal)
  if (!usesOwnedCreate && !hasFreshRepoInstance(useReposStore.getState(), repoInstance)) {
    return { ok: false, error: new Error('cancelled'), messageKey: 'error.terminal-create-failed' }
  }
  try {
    const terminalSessionId = await createTerminalSession(input, owner)
    if (!usesOwnedCreate && !hasFreshRepoInstance(useReposStore.getState(), repoInstance)) {
      return { ok: false, error: new Error('cancelled'), messageKey: 'error.terminal-create-failed' }
    }
    if (input.showCreatedTerminalTab && (input.shouldShowCreatedTerminalTab?.() ?? true)) {
      await input.showCreatedTerminalTab(terminalSessionId)
    }
    if (input.openerIdentity) {
      recordWorkspacePaneTabOpener(
        input.base.repoRoot,
        input.base.branch,
        terminalWorkspacePaneTabProvider.identity(terminalSessionId),
        input.openerIdentity,
        repoInstance,
      )
    }
    return { ok: true, terminalSessionId }
  } catch (error) {
    if (isTerminalCreateCanceled(error)) {
      return { ok: false, error, messageKey: 'error.terminal-create-failed' }
    }
    const messageKey = input.t ? showTerminalCreateErrorToast(error, input.t) : terminalCreateErrorKey(error)
    terminalLog.warn(input.logMessage ?? 'failed to create terminal', { err: error, messageKey })
    return { ok: false, error, messageKey }
  }
}

function isTerminalCreateCanceled(error: unknown): boolean {
  return error instanceof Error && error.message === TERMINAL_CREATE_CANCELED_MESSAGE
}

function createTerminalCreateOwner(repoInstance: ReturnType<typeof repoInstanceHandle>): TerminalCreateOwner | null {
  if (repoInstance === null) return null
  return {
    key: `${repoInstance.id}\0${repoInstance.repoInstanceId}`,
    isFresh: () => hasFreshRepoInstance(useReposStore.getState(), repoInstance),
  }
}

async function createTerminalSession(
  input: {
    base: TerminalSessionBase
    createTerminal: (base: TerminalSessionBase, options?: TerminalCreateOptions) => Promise<string>
    createOwnedTerminal?: (
      base: TerminalSessionBase,
      owner: TerminalCreateOwner,
      options?: TerminalCreateOptions,
    ) => Promise<string>
    options?: TerminalCreateOptions
  },
  owner: TerminalCreateOwner | null,
): Promise<string> {
  if (owner && input.createOwnedTerminal) {
    return await input.createOwnedTerminal(input.base, owner, input.options)
  }
  return await createWorkspacePaneTerminalTab({
    base: input.base,
    createTerminal: input.createTerminal,
    options: input.options,
  })
}
