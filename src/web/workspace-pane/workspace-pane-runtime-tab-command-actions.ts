import { formatTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  terminalExecutionCoordinates,
  terminalExecutionPath,
  type TerminalPresentation,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import type { TerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { FilesystemWorkspacePaneRouteCommitActions } from '#/web/app-navigation-actions.ts'
import type { FilesystemWorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { selectWorkspacePaneControllerTab } from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  runWorkspacePaneAction,
  type WorkspacePaneActionTarget,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  filesystemWorkspacePaneTargetLeaseIsCurrent,
  workspacePaneTabTargetForPaneTarget,
  workspacePaneTabTargetForWorkspace,
  gitWorktreePaneTargetLease,
  workspaceRootPaneTargetLease,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { workspacePaneRuntimeTabCommandContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-command-context.ts'
import {
  dispatchCreateTerminalWorkspacePaneRuntimeTabAction,
  type CreatedTerminalRouteRequest,
  type CreatedTerminalNavigation,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import { terminalWorkspacePaneTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import type { WorkspacePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import {
  workspacePaneFilesystemRootPath,
  workspacePaneTabsTargetForFilesystemTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { beginAppNavigation, type AppNavigationGeneration } from '#/web/app-navigation-lifecycle.ts'
import {
  claimTerminalAutoFocus,
  type TerminalAutoFocusLease,
  type TerminalPresentationFocusEffects,
} from '#/web/terminal-focus.ts'

export interface ExistingTerminalPresentationRouteRequest extends TerminalPresentationFocusEffects {
  navigationGeneration: AppNavigationGeneration
}

export interface WorkspacePaneRuntimeTabCommandContext {
  terminal?: {
    base: TerminalSessionBase | null
    bridge: TerminalSessionCommandBridge | null
    openerIdentity: string | null
    showTerminalSession: (
      terminalSessionId: string,
      routeRequest: ExistingTerminalPresentationRouteRequest,
    ) => boolean | Promise<boolean>
    showCreatedTerminalSession: (
      terminalSessionId: string,
      presentation: TerminalPresentation,
      routeRequest: CreatedTerminalRouteRequest,
    ) => boolean | Promise<boolean>
    t?: TerminalCreateTranslator
  }
}

export interface WorkspacePaneTerminalRuntimeCommandOptions {
  currentWorkspaceId: WorkspaceId | null
  target: FilesystemWorkspacePaneCommandTarget
  navigation: FilesystemWorkspacePaneRouteCommitActions & CreatedTerminalNavigation
  t?: TerminalCreateTranslator
}

interface WorkspacePaneRuntimeTabCommandActions {
  primary: (context: WorkspacePaneRuntimeTabCommandContext) => Promise<boolean>
  createNew: (context: WorkspacePaneRuntimeTabCommandContext) => Promise<boolean>
}

function existingTerminalTabTarget(
  filesystemTarget: WorkspacePaneFilesystemTarget,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
): WorkspacePaneTabModel | null {
  const routeTarget = workspacePaneTabsTargetForFilesystemTarget(filesystemTarget)
  if (routeTarget.kind === 'workspace-root') {
    const target = workspacePaneTabTargetForWorkspace(filesystemTarget.workspaceId, { workspacePaneRoute })
    return target?.workspaceRuntimeId === filesystemTarget.workspaceRuntimeId ? target : null
  }
  if (filesystemTarget.kind !== 'git-worktree') return null
  const target = workspacePaneTabTargetForPaneTarget({
    paneTarget: routeTarget,
    routeTarget,
    workspacePaneRoute,
    worktreeHead: filesystemTarget.head,
  })
  return target?.workspaceRuntimeId === filesystemTarget.workspaceRuntimeId ? target : null
}

const WORKSPACE_PANE_RUNTIME_TAB_COMMAND_ACTIONS_BY_TYPE: Record<
  WorkspacePaneRuntimeTabType,
  WorkspacePaneRuntimeTabCommandActions
> = {
  terminal: {
    primary: runTerminalPrimaryAction,
    createNew: runNewTerminalAction,
  },
}

export async function dispatchTerminalRuntimePrimaryAction(
  options: WorkspacePaneTerminalRuntimeCommandOptions,
): Promise<boolean> {
  const currentWorkspaceId = options.currentWorkspaceId
  if (!currentWorkspaceId || currentWorkspaceId !== options.target.filesystemTarget.workspaceId) return false
  if (!terminalCommandTargetIsCurrent(options.target.filesystemTarget)) return false
  const context = terminalRuntimeTabActionContext(options)
  return await runWorkspacePaneRuntimePrimaryAction('terminal', context)
}

export async function dispatchNewTerminalRuntimeTabAction(
  options: WorkspacePaneTerminalRuntimeCommandOptions,
): Promise<boolean> {
  const currentWorkspaceId = options.currentWorkspaceId
  if (!currentWorkspaceId || currentWorkspaceId !== options.target.filesystemTarget.workspaceId) return false
  if (!terminalCommandTargetIsCurrent(options.target.filesystemTarget)) return false
  const context = terminalRuntimeTabActionContext(options)
  return await runWorkspacePaneRuntimeNewAction('terminal', context)
}

function terminalCommandTargetIsCurrent(filesystemTarget: WorkspacePaneFilesystemTarget): boolean {
  const routeTarget = workspacePaneTabsTargetForFilesystemTarget(filesystemTarget)
  return routeTarget.kind === 'workspace-root'
    ? filesystemWorkspacePaneTargetLeaseIsCurrent(
        workspaceRootPaneTargetLease(routeTarget.workspaceId, filesystemTarget.workspaceRuntimeId),
      )
    : filesystemWorkspacePaneTargetLeaseIsCurrent(
        gitWorktreePaneTargetLease(
          routeTarget.workspaceId,
          filesystemTarget.workspaceRuntimeId,
          routeTarget.worktreePath,
        ),
      )
}

function terminalRuntimeTabActionContext({
  target,
  navigation,
  t,
}: WorkspacePaneTerminalRuntimeCommandOptions): WorkspacePaneRuntimeTabCommandContext {
  const { filesystemTarget, workspacePaneRoute } = target
  const workspaceId = filesystemTarget.workspaceId
  return workspacePaneRuntimeTabCommandContext({
    filesystemTarget,
    workspacePaneRoute,
    showRuntimeTab: (type, sessionId, navigationGeneration) =>
      showTerminalRuntimeTab(type, sessionId, filesystemTarget, workspacePaneRoute, navigation, navigationGeneration),
    showCreatedRuntimeTab: (type, sessionId, presentation, routeRequest) =>
      showCreatedTerminalRuntimeTab(
        type,
        sessionId,
        filesystemTarget,
        presentation,
        workspacePaneRoute,
        navigation,
        routeRequest,
      ),
    terminalCreateTranslator: t,
  })
}

export async function runWorkspacePaneRuntimePrimaryAction(
  type: WorkspacePaneRuntimeTabType,
  context: WorkspacePaneRuntimeTabCommandContext,
): Promise<boolean> {
  return await WORKSPACE_PANE_RUNTIME_TAB_COMMAND_ACTIONS_BY_TYPE[type].primary(context)
}

export async function runWorkspacePaneRuntimeNewAction(
  type: WorkspacePaneRuntimeTabType,
  context: WorkspacePaneRuntimeTabCommandContext,
): Promise<boolean> {
  return await WORKSPACE_PANE_RUNTIME_TAB_COMMAND_ACTIONS_BY_TYPE[type].createNew(context)
}

async function showTerminalRuntimeTab(
  type: WorkspacePaneRuntimeTabType,
  sessionId: string,
  filesystemTarget: WorkspacePaneFilesystemTarget,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
  navigation: FilesystemWorkspacePaneRouteCommitActions,
  routeRequest: ExistingTerminalPresentationRouteRequest,
): Promise<boolean> {
  if (type !== 'terminal') return abandonExistingTerminalPresentation(routeRequest)
  const target = existingTerminalTabTarget(filesystemTarget, workspacePaneRoute)
  if (!target) return abandonExistingTerminalPresentation(routeRequest)
  const tab = target.tabs.find(
    (candidate) => candidate.identity === terminalWorkspacePaneTabProvider.identity(sessionId),
  )
  return tab
    ? await selectWorkspacePaneControllerTab(target, tab, navigation, {
        navigationGeneration: routeRequest.navigationGeneration,
        focusEffects: routeRequest,
      })
    : abandonExistingTerminalPresentation(routeRequest)
}

function abandonExistingTerminalPresentation(routeRequest: ExistingTerminalPresentationRouteRequest): false {
  routeRequest.onAbandon()
  return false
}

function showCreatedTerminalRuntimeTab(
  type: WorkspacePaneRuntimeTabType,
  sessionId: string,
  filesystemTarget: WorkspacePaneFilesystemTarget,
  presentation: TerminalPresentation,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
  navigation: CreatedTerminalNavigation,
  routeRequest: CreatedTerminalRouteRequest,
): boolean | Promise<boolean> {
  if (type !== 'terminal') return false
  if (presentation.kind === 'git-worktree') {
    if (filesystemTarget.kind !== 'git-worktree') return false
    return navigation.commitFilesystemWorkspacePaneRoute(
      gitWorktreePaneTargetLease(
        filesystemTarget.workspaceId,
        filesystemTarget.workspaceRuntimeId,
        workspacePaneFilesystemRootPath(filesystemTarget),
      ),
      { kind: 'terminal', terminalSessionId: sessionId },
      routeRequest,
    )
  }
  if (filesystemTarget.kind === 'workspace-root') {
    if (presentation.kind !== 'workspace-root') return false
    const target = workspacePaneTabTargetForWorkspace(filesystemTarget.workspaceId, { workspacePaneRoute })
    if (!target || target.workspaceRuntimeId !== filesystemTarget.workspaceRuntimeId) return false
    const tab = target.tabs.find(
      (candidate) => candidate.identity === terminalWorkspacePaneTabProvider.identity(sessionId),
    )
    if (!tab) return false
    return navigation.commitWorkspaceRootTerminalSession(
      filesystemTarget.workspaceId,
      target.workspaceRuntimeId,
      sessionId,
      routeRequest,
    )
  }
  return false
}

async function runTerminalPrimaryAction(context: WorkspacePaneRuntimeTabCommandContext): Promise<boolean> {
  const terminal = context.terminal
  if (!terminal?.base) return false
  if (!terminal.bridge) return false
  const { base, bridge } = terminal
  const coordinates = terminalExecutionCoordinates(base.target)
  const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKey(
    coordinates.workspaceId,
    coordinates.executionRootId,
  )
  const worktree = bridge.terminalFilesystemTargetSnapshot(terminalFilesystemTargetKey)
  if (worktree.count > 0) {
    const target = terminalCoordinatorTarget(base)
    if (!target) return false
    const navigationGeneration = beginAppNavigation()
    let ownedFocusLease = claimTerminalAutoFocus(navigationGeneration)
    try {
      return await runWorkspacePaneAction(target, async () => {
        const nextWorktree = bridge.terminalFilesystemTargetSnapshot(terminalFilesystemTargetKey)
        const firstSession = nextWorktree.sessions[0]
        if (!firstSession) return nextWorktree.createPending
        const routeRequest = existingTerminalPresentationRouteRequest(
          navigationGeneration,
          firstSession.terminalSessionId,
          ownedFocusLease,
          bridge.focusTerminal,
        )
        ownedFocusLease = null
        return await terminal.showTerminalSession(firstSession.terminalSessionId, routeRequest)
      })
    } finally {
      ownedFocusLease?.release()
    }
  }
  if (worktree.createPending) return true
  const result = await dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
    base,
    createTerminal: bridge.createTerminalWithAdmission,
    openerIdentity: terminal.openerIdentity,
    showCreatedTerminalTab: (terminalSessionId, presentation, routeRequest) =>
      terminal.showCreatedTerminalSession(terminalSessionId, presentation, routeRequest),
    focusTerminal: bridge.focusTerminal,
    t: terminal.t,
    logMessage: 'terminal primary action create failed',
  })
  return result.ok
}

async function runNewTerminalAction(context: WorkspacePaneRuntimeTabCommandContext): Promise<boolean> {
  const terminal = context.terminal
  if (!terminal?.base) return false
  if (!terminal.bridge) return false
  const { base, bridge } = terminal
  const result = await dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
    base,
    createTerminal: bridge.createTerminalWithAdmission,
    openerIdentity: terminal.openerIdentity,
    showCreatedTerminalTab: (terminalSessionId, presentation, routeRequest) =>
      terminal.showCreatedTerminalSession(terminalSessionId, presentation, routeRequest),
    focusTerminal: bridge.focusTerminal,
    t: terminal.t,
  })
  return result.ok
}

function terminalCoordinatorTarget(base: TerminalSessionBase): WorkspacePaneActionTarget | null {
  const coordinates = terminalExecutionCoordinates(base.target)
  const workspaceRoot = base.target.kind === 'workspace-root'
  return workspacePaneActionTargetFromCoordinates({
    workspaceId: coordinates.workspaceId,
    workspaceRuntimeId: coordinates.workspaceRuntimeId,
    branchName: null,
    worktreePath: workspaceRoot ? null : terminalExecutionPath(base.target),
  })
}

function existingTerminalPresentationRouteRequest(
  navigationGeneration: AppNavigationGeneration,
  terminalSessionId: string,
  focusLease: TerminalAutoFocusLease | null,
  focusTerminal: TerminalSessionCommandBridge['focusTerminal'],
): ExistingTerminalPresentationRouteRequest {
  let settled = false
  return {
    navigationGeneration,
    onCommit() {
      if (settled) return
      settled = true
      focusLease?.commit(terminalSessionId, focusTerminal)
    },
    onAbandon() {
      if (settled) return
      settled = true
      focusLease?.release()
    },
  }
}
