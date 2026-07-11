import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import {
  runCreateTerminalTabCommand,
  type TerminalCreateCommandAdmission,
  type TerminalCreateCommandResult,
  type TerminalCreatedTabCommitResult,
} from '#/web/commands/terminal-create-command.ts'
import type { TerminalCreateLeaderAdmissionResult } from '#/web/components/terminal/terminal-create-admission.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import type { TerminalCreateOptions } from '#/web/components/terminal/types.ts'
import {
  commitWorkspacePaneCurrentTargetRoute,
  type WorkspacePaneTabControllerCommitNavigation,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import {
  runWorkspacePaneTabCoordinatorTask,
  workspacePaneTabCoordinatorObservedRoute,
} from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'
import { writeCanonicalWorkspacePaneTabsSnapshot } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { refreshWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { goblinLog } from '#/web/logger.ts'
import { currentRepoRuntimeId } from '#/web/stores/repos/repo-guards.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { recordWorkspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { terminalWorkspacePaneTabProvider } from '#/web/workspace-pane/tab-providers.ts'

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
  showCreatedTerminalTab: (terminalSessionId: string) => boolean | Promise<boolean>
  insertAfterIdentity?: string | null
  options?: TerminalCreateOptions
  t?: TerminalCreateTranslator
  logMessage?: string
}

export interface CommitCreatedTerminalWorkspacePaneRuntimeTabOptions {
  base: TerminalSessionBase
  admission: TerminalCreateLeaderAdmissionResult
  openerIdentity: string | null
  showCreatedTerminalTab: (terminalSessionId: string) => boolean | Promise<boolean>
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
  const base = terminalSessionBaseWithRuntime(options.base)
  if (!base) {
    const error = new Error('terminal runtime target is unavailable')
    return { ok: false, error, messageKey: 'terminal.createFailed' }
  }
  const target = terminalWorkspacePaneCoordinatorTarget(base)
  return await runWorkspacePaneTabCoordinatorTask(target, async () =>
    await runCreateTerminalTabCommand({
      base,
      createTerminal: options.createTerminal,
      options: options.options,
      insertAfterIdentity: options.insertAfterIdentity,
      t: options.t,
      logMessage: options.logMessage,
      commitCreatedTerminalTab: async (admission) =>
        await commitCreatedTerminalWorkspacePaneRuntimeTab({
          base,
          admission,
          openerIdentity: options.openerIdentity,
          showCreatedTerminalTab: options.showCreatedTerminalTab,
        }),
    }),
  )
}

export function showCreatedTerminalWorkspacePaneRuntimeTab(
  base: TerminalSessionBase,
  terminalSessionId: string,
  navigation: WorkspacePaneTabControllerCommitNavigation,
): boolean | Promise<boolean> {
  const resolvedBase = terminalSessionBaseWithRuntime(base)
  if (!resolvedBase) return false
  const target = terminalWorkspacePaneCoordinatorTarget(resolvedBase)
  return commitWorkspacePaneCurrentTargetRoute(
    target,
    workspacePaneTabCoordinatorObservedRoute(target),
    { kind: 'terminal', terminalSessionId },
    navigation,
  )
}

export async function commitCreatedTerminalWorkspacePaneRuntimeTab(
  options: CommitCreatedTerminalWorkspacePaneRuntimeTabOptions,
): Promise<TerminalCreatedTabCommitResult> {
  const projectionStatus = await applyCreatedTerminalWorkspacePaneRuntimeTabs(options)
  if (projectionStatus !== 'accepted') return { status: projectionStatus }
  if (!terminalCreateTargetRuntimeIsCurrent(options.base)) return { status: 'superseded' }
  recordCreatedTerminalWorkspacePaneRuntimeTabOpener(options)
  const navigationCommitted = await options.showCreatedTerminalTab(options.admission.terminalSessionId)
  return navigationCommitted ? { status: 'committed' } : { status: 'navigation-rejected' }
}

function recordCreatedTerminalWorkspacePaneRuntimeTabOpener(
  options: CommitCreatedTerminalWorkspacePaneRuntimeTabOptions,
): void {
  if (!options.openerIdentity || options.admission.resourceDisposition !== 'created') return
  const repoRuntimeId = options.base.repoRuntimeId
  if (!repoRuntimeId) return
  recordWorkspacePaneTabOpener(
    options.base.repoRoot,
    repoRuntimeId,
    options.base.branch,
    terminalWorkspacePaneTabProvider.identity(options.admission.terminalSessionId),
    options.openerIdentity,
  )
}

function terminalWorkspacePaneCoordinatorTarget(base: TerminalSessionBase & { repoRuntimeId: string }) {
  return {
    repoId: base.repoRoot,
    repoRuntimeId: base.repoRuntimeId,
    branchName: base.branch,
    worktreePath: base.worktreePath,
  }
}

function terminalSessionBaseWithRuntime(
  base: TerminalSessionBase,
): (TerminalSessionBase & { repoRuntimeId: string }) | null {
  const repoRuntimeId = base.repoRuntimeId
  return repoRuntimeId ? { ...base, repoRuntimeId } : null
}

async function applyCreatedTerminalWorkspacePaneRuntimeTabs(
  options: CommitCreatedTerminalWorkspacePaneRuntimeTabOptions,
): Promise<'accepted' | 'superseded' | 'projection-failed'> {
  const repoRuntimeId = options.base.repoRuntimeId
  if (!repoRuntimeId) return 'superseded'
  try {
    const accepted = await writeCanonicalWorkspacePaneTabsSnapshot(
      options.base.repoRoot,
      repoRuntimeId,
      options.admission.workspacePaneTabs,
    )
    return accepted ? 'accepted' : 'superseded'
  } catch (err) {
    goblinLog.warn('failed to apply application-returned workspace pane tabs', {
      repoRoot: options.base.repoRoot,
      repoRuntimeId,
      branchName: options.base.branch,
      worktreePath: options.base.worktreePath,
      err,
    })
    refreshWorkspacePaneTabs(options.base.repoRoot, repoRuntimeId)
    return 'projection-failed'
  }
}

function terminalCreateTargetRuntimeIsCurrent(base: TerminalSessionBase): boolean {
  const repoRuntimeId = base.repoRuntimeId
  return (
    typeof repoRuntimeId === 'string' && currentRepoRuntimeId(useReposStore.getState(), base.repoRoot) === repoRuntimeId
  )
}

function terminalRuntimeTabCreateAction(
  context: WorkspacePaneRuntimeTabCreateActionContext,
): WorkspacePaneRuntimeTabCreateAction | null {
  const terminal = context.terminal
  const base = terminal?.base ? terminalSessionBaseWithRuntime(terminal.base) : null
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
