import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { runCreateTerminalTabCommand } from '#/web/commands/terminal-create-command.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import type { TerminalCreateOptions, TerminalCreateOwner } from '#/web/components/terminal/types.ts'
import { captureWorkspacePaneActiveTabIdentity } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'

export interface WorkspacePaneRuntimeTabCreateAction {
  label: string
  busy: boolean
  blocksTabInteraction: boolean
  onCreate: () => void
}

export interface WorkspacePaneRuntimeTabCreateActionContext {
  repoRoot: string
  runtimeTabStateByType: WorkspacePaneRuntimeTabCreateStateByType
  initialRuntimeProjectionHydrating: boolean
  showCreatedRuntimeTab: (type: WorkspacePaneRuntimeTabType, sessionId: string) => void | Promise<void>
  t: TerminalCreateTranslator
  terminal?: WorkspacePaneTerminalCreateActionContext
}

export type WorkspacePaneRuntimeTabCreateStateByType = Record<WorkspacePaneRuntimeTabType, { createPending: boolean }>

export interface WorkspacePaneTerminalCreateActionContext {
  base: TerminalSessionBase | null
  createTerminal: (base: TerminalSessionBase, options?: TerminalCreateOptions) => Promise<string>
  createOwnedTerminal?: (
    base: TerminalSessionBase,
    owner: TerminalCreateOwner,
    options?: TerminalCreateOptions,
  ) => Promise<string>
}

interface WorkspacePaneRuntimeTabCreateActionResolver {
  resolve: (context: WorkspacePaneRuntimeTabCreateActionContext) => WorkspacePaneRuntimeTabCreateAction | null
}

const WORKSPACE_PANE_RUNTIME_TAB_CREATE_ACTION_RESOLVERS_BY_TYPE: Record<
  WorkspacePaneRuntimeTabType,
  WorkspacePaneRuntimeTabCreateActionResolver
> = {
  terminal: {
    resolve: terminalRuntimeTabCreateAction,
  },
}

export function workspacePaneRuntimeTabCreateAction(
  type: WorkspacePaneRuntimeTabType,
  context: WorkspacePaneRuntimeTabCreateActionContext,
): WorkspacePaneRuntimeTabCreateAction | null {
  return WORKSPACE_PANE_RUNTIME_TAB_CREATE_ACTION_RESOLVERS_BY_TYPE[type].resolve(context)
}

function terminalRuntimeTabCreateAction(
  context: WorkspacePaneRuntimeTabCreateActionContext,
): WorkspacePaneRuntimeTabCreateAction | null {
  const terminal = context.terminal
  const base = terminal?.base
  if (!terminal || !base) return null
  return {
    label: context.t('terminal.new'),
    busy: context.initialRuntimeProjectionHydrating || context.runtimeTabStateByType.terminal.createPending,
    blocksTabInteraction: context.runtimeTabStateByType.terminal.createPending,
    onCreate: () => {
      // "+" is a generic entry; opener only drives close-back focus, not insertion.
      const openerIdentity = captureWorkspacePaneActiveTabIdentity(context.repoRoot, base.branch)
      void runCreateTerminalTabCommand({
        base,
        createTerminal: terminal.createTerminal,
        createOwnedTerminal: terminal.createOwnedTerminal,
        openerIdentity,
        showCreatedTerminalTab: (terminalSessionId) => context.showCreatedRuntimeTab('terminal', terminalSessionId),
        t: context.t,
      })
    },
  }
}
