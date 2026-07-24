import {
  terminalExecutionCoordinates,
  terminalExecutionPath,
  terminalPresentationBranch,
  terminalSessionBase,
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
import type { TerminalCreateAdmissionResult } from '#/web/components/terminal/terminal-create-admission.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import type { TerminalCreateOptions, TerminalFocusRequest } from '#/web/components/terminal/types.ts'
import { commitWorkspacePaneCurrentTargetRoute } from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { gitWorktreePaneTargetLease } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  workspacePaneActionTargetFromFilesystemTarget,
  runWorkspacePaneAction,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { currentWorkspaceRuntimeId } from '#/web/stores/workspaces/workspace-guards.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { recordWorkspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { terminalWorkspacePaneTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import {
  workspacePaneTabsTargetFromRuntime,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import {
  beginPrimaryWindowPresentation,
  type PrimaryWindowPresentationToken,
} from '#/web/primary-window-presentation.ts'
import { claimTerminalAutoFocus } from '#/web/terminal-focus.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation-actions.ts'

export interface CreatedTerminalRouteRequest {
  presentationToken: PrimaryWindowPresentationToken
  routeTarget: WorkspacePaneTabsTarget
}

export type CreatedTerminalNavigation = Pick<
  PrimaryWindowNavigationActions,
  'commitWorkspacePaneRoute' | 'commitFilesystemWorkspacePaneRoute' | 'commitWorkspaceRootTerminalSession'
>

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
    routeRequest: CreatedTerminalRouteRequest,
  ) => boolean | Promise<boolean>
  t: TerminalCreateTranslator
  terminal?: WorkspacePaneTerminalCreateActionContext
}

export type WorkspacePaneRuntimeTabCreateStateByType = Record<WorkspacePaneRuntimeTabType, { createPending: boolean }>

export interface WorkspacePaneTerminalCreateActionContext {
  routeTarget: WorkspacePaneTabsTarget
  base: TerminalSessionBase | null
  createTerminal: (
    base: TerminalSessionBase,
    options?: TerminalCreateOptions,
    placement?: WorkspacePaneRuntimeTabPlacement,
  ) => Promise<TerminalCreateCommandAdmission>
  captureOpenerIdentity: () => string | null
  focusTerminal: (terminalSessionId: string, request?: TerminalFocusRequest) => boolean
}

export interface CreateTerminalWorkspacePaneRuntimeTabActionOptions {
  routeTarget: WorkspacePaneTabsTarget
  base: TerminalSessionBase
  createTerminal: (
    base: TerminalSessionBase,
    options?: TerminalCreateOptions,
    placement?: WorkspacePaneRuntimeTabPlacement,
  ) => Promise<TerminalCreateCommandAdmission>
  openerIdentity: string | null
  showCreatedTerminalTab: (
    terminalSessionId: string,
    presentation: TerminalPresentation,
    routeRequest: CreatedTerminalRouteRequest,
  ) => boolean | Promise<boolean>
  focusTerminal: (terminalSessionId: string, request?: TerminalFocusRequest) => boolean
  insertAfterIdentity?: string | null
  options?: TerminalCreateOptions
  t?: TerminalCreateTranslator
  logMessage?: string
}

export interface CommitCreatedTerminalWorkspacePaneRuntimeTabOptions {
  base: TerminalSessionBase
  admission: TerminalCreateAdmissionResult
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
  const base = options.base
  const target = terminalWorkspacePaneCoordinatorTarget(base)
  const presentationToken = beginPrimaryWindowPresentation()
  let ownedFocusLease = claimTerminalAutoFocus(presentationToken)
  try {
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
              showCreatedTerminalTab: async (terminalSessionId, presentation) => {
                const accepted = await options.showCreatedTerminalTab(terminalSessionId, presentation, {
                  presentationToken,
                  routeTarget: options.routeTarget,
                })
                if (accepted) ownedFocusLease?.commit(terminalSessionId, options.focusTerminal)
                else ownedFocusLease?.release()
                ownedFocusLease = null
                return accepted
              },
            }),
        }),
    )
  } finally {
    ownedFocusLease?.release()
  }
}

export function showCreatedTerminalWorkspacePaneRuntimeTab(
  base: TerminalSessionBase,
  terminalSessionId: string,
  navigation: CreatedTerminalNavigation,
  routeRequest: CreatedTerminalRouteRequest,
): boolean | Promise<boolean> {
  const coordinates = terminalExecutionCoordinates(base.target)
  const paneTarget = workspacePaneTabsTargetFromRuntime(base.target)
  if (!paneTarget) return false
  const routeTarget = routeRequest.routeTarget
  if (routeTarget.workspaceId !== coordinates.workspaceId) return false
  const workspaceRoot = base.target.kind === 'workspace-root'
  if (workspaceRoot) {
    if (base.presentation.kind !== 'workspace-root' || routeTarget.kind !== 'workspace-root') return false
    return navigation.commitWorkspaceRootTerminalSession(
      coordinates.workspaceId,
      coordinates.workspaceRuntimeId,
      terminalSessionId,
      routeRequest,
    )
  }
  if (routeTarget.kind === 'git-worktree') {
    if (base.presentation.kind !== 'git-worktree') return false
    return navigation.commitFilesystemWorkspacePaneRoute(
      gitWorktreePaneTargetLease(
        coordinates.workspaceId,
        coordinates.workspaceRuntimeId,
        terminalExecutionPath(base.target),
        base.presentation.head,
      ),
      { kind: 'terminal', terminalSessionId },
      routeRequest,
    )
  }
  if (routeTarget.kind !== 'git-branch') return false
  const branchName = terminalPresentationBranch(base.presentation)
  if (!branchName) return false
  return commitWorkspacePaneCurrentTargetRoute(
    {
      workspaceId: coordinates.workspaceId,
      workspaceRuntimeId: coordinates.workspaceRuntimeId,
      routeTarget: { ...routeTarget, branchName },
      branchName,
      worktreePath: terminalExecutionPath(base.target),
      paneTarget,
    },
    { kind: 'terminal', terminalSessionId },
    navigation,
    undefined,
    routeRequest.presentationToken,
  )
}

export async function commitCreatedTerminalWorkspacePaneRuntimeTab(
  options: CommitCreatedTerminalWorkspacePaneRuntimeTabOptions,
): Promise<TerminalCreatedTabCommitResult> {
  const canonicalBase = terminalSessionBase(options.base.target, options.admission.presentation)
  const canonicalOptions = { ...options, base: canonicalBase }
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
  const ownsCreatedResource =
    options.admission.requestRole === 'leader' && options.admission.resourceDisposition === 'created'
  if (!options.openerIdentity || !ownsCreatedResource) return
  const coordinates = terminalExecutionCoordinates(options.base.target)
  const paneTarget = workspacePaneTabsTargetFromRuntime(options.base.target)
  if (!paneTarget) return
  recordWorkspacePaneTabOpener(
    paneTarget,
    coordinates.workspaceRuntimeId,
    terminalWorkspacePaneTabProvider.identity(options.admission.terminalSessionId),
    options.openerIdentity,
  )
}

function terminalWorkspacePaneCoordinatorTarget(base: TerminalSessionBase) {
  return workspacePaneActionTargetFromFilesystemTarget(base.target)
}

function terminalCreateTargetRuntimeIsCurrent(base: TerminalSessionBase): boolean {
  const coordinates = terminalExecutionCoordinates(base.target)
  return (
    currentWorkspaceRuntimeId(useWorkspacesStore.getState(), coordinates.workspaceId) === coordinates.workspaceRuntimeId
  )
}

function terminalRuntimeTabCreateAction(
  context: WorkspacePaneRuntimeTabCreateActionContext,
): WorkspacePaneRuntimeTabCreateAction | null {
  const terminal = context.terminal
  const base = terminal?.base ?? null
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
        routeTarget: terminal.routeTarget,
        base,
        createTerminal: terminal.createTerminal,
        openerIdentity,
        showCreatedTerminalTab: (terminalSessionId, presentation, routeRequest) =>
          context.showCreatedRuntimeTab('terminal', terminalSessionId, presentation, routeRequest),
        focusTerminal: terminal.focusTerminal,
        t: context.t,
      })
    },
  }
}
