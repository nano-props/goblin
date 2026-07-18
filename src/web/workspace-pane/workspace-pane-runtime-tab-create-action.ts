import {
  terminalExecutionCoordinates,
  terminalExecutionPath,
  terminalPresentationBranch,
  type TerminalPresentation,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneRuntimeTabPlacement } from '#/shared/workspace-pane-runtime.ts'
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
  workspacePaneActionTargetFromCoordinates,
  workspacePaneActionTargetFromFilesystemTarget,
  runWorkspacePaneAction,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { currentRepoRuntimeId } from '#/web/stores/repos/repo-guards.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { recordWorkspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { terminalWorkspacePaneTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import { workspacePaneTabsTargetFromRuntime } from '#/shared/workspace-pane-tabs-target.ts'

export interface WorkspacePaneRuntimeTabCreateAction {
  label: string
  busy: boolean
  blocksTabInteraction: boolean
  onCreate: () => void
}

export interface WorkspacePaneRuntimeTabCreateActionContext {
  runtimeTabStateByType: WorkspacePaneRuntimeTabCreateStateByType
  showCreatedRuntimeTab: (
    type: WorkspacePaneRuntimeTabType,
    sessionId: string,
    presentation: TerminalPresentation,
  ) => boolean | Promise<boolean>
  t: TerminalCreateTranslator
  terminal?: WorkspacePaneTerminalCreateActionContext
}

export type WorkspacePaneRuntimeTabCreateStateByType = Record<WorkspacePaneRuntimeTabType, { createPending: boolean }>

export interface WorkspacePaneTerminalCreateActionContext {
  base: TerminalSessionBase | null
  createTerminal: (
    base: TerminalSessionBase,
    options?: TerminalCreateOptions,
    placement?: WorkspacePaneRuntimeTabPlacement,
  ) => Promise<TerminalCreateCommandAdmission>
  captureOpenerIdentity: () => string | null
}

export interface CreateTerminalWorkspacePaneRuntimeTabActionOptions {
  base: TerminalSessionBase
  createTerminal: (
    base: TerminalSessionBase,
    options?: TerminalCreateOptions,
    placement?: WorkspacePaneRuntimeTabPlacement,
  ) => Promise<TerminalCreateCommandAdmission>
  openerIdentity: string | null
  showCreatedTerminalTab: (terminalSessionId: string, presentation: TerminalPresentation) => boolean | Promise<boolean>
  insertAfterIdentity?: string | null
  options?: TerminalCreateOptions
  t?: TerminalCreateTranslator
  logMessage?: string
}

export interface CommitCreatedTerminalWorkspacePaneRuntimeTabOptions {
  base: TerminalSessionBase
  admission: TerminalCreateLeaderAdmissionResult
  openerIdentity: string | null
  showCreatedTerminalTab: (terminalSessionId: string, presentation: TerminalPresentation) => boolean | Promise<boolean>
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
  return await runWorkspacePaneAction(
    target,
    async () =>
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
  const coordinates = terminalExecutionCoordinates(resolvedBase.target)
  const paneTarget = workspacePaneTabsTargetFromRuntime(resolvedBase.target)
  if (!paneTarget) return false
  const workspaceRoot = resolvedBase.target.kind === 'workspace-root'
  if (
    !workspaceRoot &&
    resolvedBase.presentation.kind === 'git-worktree' &&
    resolvedBase.presentation.head.kind === 'detached'
  ) {
    return (
      navigation.showRepoWorktreeTerminalSession?.(
        coordinates.repoRoot,
        terminalExecutionPath(resolvedBase.target),
        terminalSessionId,
      ) ?? false
    )
  }
  return commitWorkspacePaneCurrentTargetRoute(
    {
      repoId: coordinates.repoRoot,
      repoRuntimeId: coordinates.repoRuntimeId,
      branchName: workspaceRoot ? null : terminalPresentationBranch(resolvedBase.presentation),
      worktreePath: workspaceRoot ? null : terminalExecutionPath(resolvedBase.target),
      paneTarget,
    },
    { kind: 'terminal', terminalSessionId },
    navigation,
  )
}

export async function commitCreatedTerminalWorkspacePaneRuntimeTab(
  options: CommitCreatedTerminalWorkspacePaneRuntimeTabOptions,
): Promise<TerminalCreatedTabCommitResult> {
  const canonicalBase = terminalBaseWithPresentation(options.base, options.admission.presentation)
  if (!canonicalBase) return { status: 'superseded' }
  const canonicalOptions = { ...options, base: canonicalBase }
  const projectionStatus = applyCreatedTerminalWorkspacePaneRuntimeTabs(canonicalOptions)
  if (projectionStatus !== 'accepted') return { status: projectionStatus }
  if (!terminalCreateTargetRuntimeIsCurrent(canonicalOptions.base)) return { status: 'superseded' }
  recordCreatedTerminalWorkspacePaneRuntimeTabOpener(canonicalOptions)
  const navigationCommitted = await options.showCreatedTerminalTab(
    options.admission.terminalSessionId,
    options.admission.presentation,
  )
  return navigationCommitted ? { status: 'committed' } : { status: 'navigation-rejected' }
}

function recordCreatedTerminalWorkspacePaneRuntimeTabOpener(
  options: CommitCreatedTerminalWorkspacePaneRuntimeTabOptions,
): void {
  if (!options.openerIdentity || options.admission.resourceDisposition !== 'created') return
  const coordinates = terminalExecutionCoordinates(options.base.target)
  const paneTarget = workspacePaneTabsTargetFromRuntime(options.base.target)
  if (!paneTarget) return
  recordWorkspacePaneTabOpener(
    paneTarget,
    coordinates.repoRuntimeId,
    terminalWorkspacePaneTabProvider.identity(options.admission.terminalSessionId),
    options.openerIdentity,
  )
}

function terminalWorkspacePaneCoordinatorTarget(base: TerminalSessionBase) {
  return workspacePaneActionTargetFromFilesystemTarget(base.target)
}

function terminalSessionBaseWithRuntime(base: TerminalSessionBase): TerminalSessionBase {
  return base
}

function terminalBaseWithPresentation(
  base: TerminalSessionBase,
  presentation: TerminalPresentation,
): TerminalSessionBase | null {
  if (base.target.kind === 'workspace-root' && presentation.kind === 'workspace-root') {
    return { target: base.target, presentation }
  }
  if (base.target.kind === 'git-worktree' && presentation.kind === 'git-worktree') {
    return { target: base.target, presentation }
  }
  return null
}

function applyCreatedTerminalWorkspacePaneRuntimeTabs(
  options: CommitCreatedTerminalWorkspacePaneRuntimeTabOptions,
): 'accepted' | 'superseded' | 'projection-failed' {
  if (!terminalCreateTargetRuntimeIsCurrent(options.base)) return 'superseded'
  return 'accepted'
}

function terminalCreateTargetRuntimeIsCurrent(base: TerminalSessionBase): boolean {
  const coordinates = terminalExecutionCoordinates(base.target)
  return currentRepoRuntimeId(useReposStore.getState(), coordinates.repoRoot) === coordinates.repoRuntimeId
}

function terminalRuntimeTabCreateAction(
  context: WorkspacePaneRuntimeTabCreateActionContext,
): WorkspacePaneRuntimeTabCreateAction | null {
  const terminal = context.terminal
  const base = terminal?.base ? terminalSessionBaseWithRuntime(terminal.base) : null
  if (!terminal || !base) return null
  return {
    label: context.t('terminal.new'),
    busy: context.runtimeTabStateByType.terminal.createPending,
    blocksTabInteraction: context.runtimeTabStateByType.terminal.createPending,
    onCreate: () => {
      if (context.runtimeTabStateByType.terminal.createPending) return
      // "+" is a generic entry; opener only drives close-back focus, not insertion.
      const openerIdentity = terminal.captureOpenerIdentity()
      void dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
        base,
        createTerminal: terminal.createTerminal,
        openerIdentity,
        showCreatedTerminalTab: (terminalSessionId, presentation) =>
          context.showCreatedRuntimeTab('terminal', terminalSessionId, presentation),
        t: context.t,
      })
    },
  }
}
