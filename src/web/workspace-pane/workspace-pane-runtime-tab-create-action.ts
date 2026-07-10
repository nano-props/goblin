import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import {
  runCreateTerminalTabCommand,
  type TerminalCreateCommandAdmission,
  type TerminalCreateCommandResult,
  type TerminalCreatedTabCommitResult,
} from '#/web/commands/terminal-create-command.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import type { TerminalCreateOptions } from '#/web/components/terminal/types.ts'
import { runWorkspacePaneTabCoordinatorTask } from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'
import {
  commitWorkspacePaneControllerRoute,
  type WorkspacePaneTabControllerCommitNavigation,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { writeCanonicalWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { refreshWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { gblLog } from '#/web/logger.ts'

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
  showCreatedRuntimeTab: (type: WorkspacePaneRuntimeTabType, sessionId: string) => boolean | Promise<boolean>
  t: TerminalCreateTranslator
  terminal?: WorkspacePaneTerminalCreateActionContext
}

export type WorkspacePaneRuntimeTabCreateStateByType = Record<WorkspacePaneRuntimeTabType, { createPending: boolean }>

export interface WorkspacePaneTerminalCreateActionContext {
  base: TerminalSessionBase | null
  createTerminal: (
    base: TerminalSessionBase,
    options?: TerminalCreateOptions,
    placement?: import('#/shared/workspace-pane-runtime.ts').WorkspacePaneRuntimeTabPlacement,
  ) => Promise<TerminalCreateCommandAdmission>
  captureOpenerIdentity: () => string | null
}

export interface CreateTerminalWorkspacePaneRuntimeTabActionOptions {
  base: TerminalSessionBase
  createTerminal: (
    base: TerminalSessionBase,
    options?: TerminalCreateOptions,
    placement?: import('#/shared/workspace-pane-runtime.ts').WorkspacePaneRuntimeTabPlacement,
  ) => Promise<TerminalCreateCommandAdmission>
  openerIdentity: string | null
  showCreatedTerminalTab?: (terminalSessionId: string) => boolean | Promise<boolean>
  insertAfterIdentity?: string | null
  options?: TerminalCreateOptions
  t?: TerminalCreateTranslator
  logMessage?: string
}

export interface CommitCreatedTerminalWorkspacePaneRuntimeTabOptions {
  base: TerminalSessionBase
  terminalSessionId: string
  workspacePaneTabs: WorkspacePaneTabEntry[]
  showCreatedTerminalTab?: (terminalSessionId: string) => boolean | Promise<boolean>
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

export async function dispatchCreateTerminalWorkspacePaneRuntimeTabAction(
  options: CreateTerminalWorkspacePaneRuntimeTabActionOptions,
): Promise<TerminalCreateCommandResult> {
  return await runCreateTerminalTabCommand({
    ...options,
    insertAfterIdentity: options.insertAfterIdentity,
    commitCreatedTerminalTab: async (terminalSessionId, workspacePaneTabs) =>
      await commitCreatedTerminalWorkspacePaneRuntimeTab({
        base: options.base,
        terminalSessionId,
        workspacePaneTabs,
        showCreatedTerminalTab: options.showCreatedTerminalTab,
      }),
  })
}

export function showCreatedTerminalWorkspacePaneRuntimeTab(
  base: TerminalSessionBase,
  terminalSessionId: string,
  navigation: WorkspacePaneTabControllerCommitNavigation,
): boolean | Promise<boolean> {
  return commitWorkspacePaneControllerRoute(
    base.repoRoot,
    base.branch,
    { kind: 'terminal', terminalSessionId },
    navigation,
  )
}

export async function commitCreatedTerminalWorkspacePaneRuntimeTab(
  options: CommitCreatedTerminalWorkspacePaneRuntimeTabOptions,
): Promise<TerminalCreatedTabCommitResult> {
  return await runWorkspacePaneTabCoordinatorTask(
    { repoId: options.base.repoRoot, branchName: options.base.branch, worktreePath: options.base.worktreePath },
    async () => {
      const workspacePaneProjectionApplied = await applyCreatedTerminalWorkspacePaneRuntimeTabs(options)
      const navigationCommitted = options.showCreatedTerminalTab
        ? await options.showCreatedTerminalTab(options.terminalSessionId)
        : true
      return { workspacePaneProjectionApplied, navigationCommitted }
    },
  )
}

async function applyCreatedTerminalWorkspacePaneRuntimeTabs(
  options: CommitCreatedTerminalWorkspacePaneRuntimeTabOptions,
): Promise<boolean> {
  const repoRuntimeId = options.base.repoRuntimeId
  if (!repoRuntimeId) return false
  try {
    return await writeCanonicalWorkspacePaneTabsForTarget({
      repoRoot: options.base.repoRoot,
      repoRuntimeId,
      branchName: options.base.branch,
      worktreePath: options.base.worktreePath,
      tabs: options.workspacePaneTabs,
    })
  } catch (err) {
    gblLog.warn('failed to apply application-returned workspace pane tabs', {
      repoRoot: options.base.repoRoot,
      repoRuntimeId,
      branchName: options.base.branch,
      worktreePath: options.base.worktreePath,
      err,
    })
    refreshWorkspacePaneTabs(options.base.repoRoot, repoRuntimeId)
    return false
  }
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
      if (context.runtimeTabStateByType.terminal.createPending) return
      // "+" is a generic entry; opener only drives close-back focus, not insertion.
      const openerIdentity = terminal.captureOpenerIdentity()
      void dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
        base,
        createTerminal: terminal.createTerminal,
        openerIdentity,
        showCreatedTerminalTab: (terminalSessionId) => context.showCreatedRuntimeTab('terminal', terminalSessionId),
        t: context.t,
      })
    },
  }
}
