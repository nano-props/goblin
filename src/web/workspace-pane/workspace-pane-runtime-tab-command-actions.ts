import { formatTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  terminalExecutionCoordinates,
  terminalExecutionPath,
  terminalPresentationBranch,
  type TerminalPresentation,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import type { TerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspacePaneTabControllerCommitNavigation } from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import {
  commitWorkspacePaneCommittedRuntimeTargetRoute,
  commitWorkspacePaneCurrentTargetRoute,
  selectWorkspacePaneControllerTab,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  runWorkspacePaneAction,
  type WorkspacePaneActionTarget,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  workspacePaneTabTargetForBranch,
  workspacePaneTabTargetForCreatedRuntime,
  workspacePaneTabTargetForPaneTarget,
  workspacePaneTabTargetForWorkspace,
  gitWorktreePaneTargetLease,
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
  beginPrimaryWindowNavigation,
  type PrimaryWindowNavigationGeneration,
} from '#/web/primary-window-navigation-lifecycle.ts'
import {
  claimTerminalAutoFocus,
  type TerminalAutoFocusLease,
  type TerminalPresentationFocusEffects,
} from '#/web/terminal-focus.ts'

export interface ExistingTerminalPresentationRouteRequest extends TerminalPresentationFocusEffects {
  navigationGeneration: PrimaryWindowNavigationGeneration
}

export interface WorkspacePaneRuntimeTabCommandContext {
  terminal?: {
    routeTarget: WorkspacePaneTabsTarget
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

interface WorkspacePaneTerminalRuntimeCommandOptionsBase {
  workspaceId: WorkspaceId | null
  routeTarget: WorkspacePaneTabsTarget
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  navigation: WorkspacePaneTabControllerCommitNavigation & CreatedTerminalNavigation
  t?: TerminalCreateTranslator
}

export type WorkspacePaneTerminalRuntimeCommandOptions = WorkspacePaneTerminalRuntimeCommandOptionsBase &
  (
    | { branchName: string; filesystemTarget: null }
    | { branchName: string | null; filesystemTarget: WorkspacePaneFilesystemTarget }
  )

interface WorkspacePaneRuntimeTabCommandActions {
  primary: (context: WorkspacePaneRuntimeTabCommandContext) => Promise<boolean>
  createNew: (context: WorkspacePaneRuntimeTabCommandContext) => Promise<boolean>
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
  if (!options.workspaceId) return false
  return await terminalRuntimePrimaryAction(options)
}

async function terminalRuntimePrimaryAction({
  workspaceId,
  routeTarget,
  branchName,
  filesystemTarget,
  workspacePaneRoute,
  navigation,
  t,
}: WorkspacePaneTerminalRuntimeCommandOptions): Promise<boolean> {
  if (!workspaceId) return false
  return await runWorkspacePaneRuntimePrimaryAction(
    'terminal',
    workspacePaneRuntimeTabCommandContext({
      workspaceId,
      routeTarget,
      branchName,
      filesystemTarget,
      workspacePaneRoute,
      showRuntimeTab: (type, sessionId, navigationGeneration) =>
        showTerminalRuntimeTab(
          type,
          sessionId,
          workspaceId,
          routeTarget,
          filesystemTarget,
          workspacePaneRoute,
          navigation,
          navigationGeneration,
        ),
      showCreatedRuntimeTab: (type, sessionId, presentation, worktreePath, routeRequest) =>
        showCreatedTerminalRuntimeTab(
          type,
          sessionId,
          workspaceId,
          routeTarget,
          filesystemTarget?.workspaceRuntimeId ?? null,
          presentation,
          worktreePath,
          workspacePaneRoute,
          navigation,
          routeRequest,
        ),
      terminalCreateTranslator: t,
    }),
  )
}

export async function dispatchNewTerminalRuntimeTabAction(
  options: WorkspacePaneTerminalRuntimeCommandOptions,
): Promise<boolean> {
  const { workspaceId } = options
  if (!workspaceId) return false
  const context = newTerminalRuntimeTabActionContext({ ...options, workspaceId })
  return await runWorkspacePaneRuntimeNewAction('terminal', context)
}

function newTerminalRuntimeTabActionContext({
  workspaceId,
  routeTarget,
  branchName,
  filesystemTarget,
  workspacePaneRoute,
  navigation,
  t,
}: WorkspacePaneTerminalRuntimeCommandOptions & { workspaceId: WorkspaceId }): WorkspacePaneRuntimeTabCommandContext {
  return workspacePaneRuntimeTabCommandContext({
    workspaceId,
    routeTarget,
    branchName,
    filesystemTarget,
    workspacePaneRoute,
    showRuntimeTab: (type, sessionId, navigationGeneration) =>
      showTerminalRuntimeTab(
        type,
        sessionId,
        workspaceId,
        routeTarget,
        filesystemTarget,
        workspacePaneRoute,
        navigation,
        navigationGeneration,
      ),
    showCreatedRuntimeTab: (type, sessionId, presentation, worktreePath, routeRequest) =>
      showCreatedTerminalRuntimeTab(
        type,
        sessionId,
        workspaceId,
        routeTarget,
        filesystemTarget?.workspaceRuntimeId ?? null,
        presentation,
        worktreePath,
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
  workspaceId: WorkspaceId,
  routeTarget: WorkspacePaneTabsTarget,
  filesystemTarget: WorkspacePaneFilesystemTarget | null | undefined,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
  navigation: WorkspacePaneTabControllerCommitNavigation,
  routeRequest: ExistingTerminalPresentationRouteRequest,
): Promise<boolean> {
  if (type !== 'terminal') return abandonExistingTerminalPresentation(routeRequest)
  const target =
    routeTarget.kind === 'git-branch'
      ? workspacePaneTabTargetForBranch(workspaceId, routeTarget.branchName, { workspacePaneRoute })
      : routeTarget.kind === 'workspace-root'
        ? workspacePaneTabTargetForWorkspace(workspaceId, { workspacePaneRoute })
        : filesystemTarget?.kind === 'git-worktree'
          ? workspacePaneTabTargetForPaneTarget({
              paneTarget: routeTarget,
              routeTarget,
              workspacePaneRoute,
              worktreeHead: filesystemTarget.head,
            })
          : null
  if (!target) return abandonExistingTerminalPresentation(routeRequest)
  if (routeTarget.kind !== 'git-branch') {
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
  return await commitWorkspacePaneCurrentTargetRoute(
    target,
    { kind: 'terminal', terminalSessionId: sessionId },
    navigation,
    routeRequest,
    routeRequest.navigationGeneration,
  )
}

function abandonExistingTerminalPresentation(routeRequest: ExistingTerminalPresentationRouteRequest): false {
  routeRequest.onAbandon()
  return false
}

function showCreatedTerminalRuntimeTab(
  type: WorkspacePaneRuntimeTabType,
  sessionId: string,
  workspaceId: WorkspaceId,
  routeTarget: WorkspacePaneTabsTarget,
  workspaceRuntimeId: string | null,
  presentation: TerminalPresentation,
  worktreePath: string,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
  navigation: CreatedTerminalNavigation,
  routeRequest: CreatedTerminalRouteRequest,
): boolean | Promise<boolean> {
  if (type !== 'terminal') return false
  let target
  if (routeTarget.kind === 'git-worktree') {
    if (!workspaceRuntimeId || presentation.kind !== 'git-worktree') return false
    return navigation.commitFilesystemWorkspacePaneRoute(
      gitWorktreePaneTargetLease(workspaceId, workspaceRuntimeId, worktreePath, presentation.head),
      { kind: 'terminal', terminalSessionId: sessionId },
      routeRequest,
    )
  }
  if (routeTarget.kind === 'workspace-root') {
    if (presentation.kind !== 'workspace-root') return false
    target = workspacePaneTabTargetForWorkspace(workspaceId, { workspacePaneRoute })
  } else {
    if (presentation.kind !== 'git-worktree') return false
    const canonicalBranch = terminalPresentationBranch(presentation)
    if (!canonicalBranch) return false
    target = workspacePaneTabTargetForCreatedRuntime(workspaceId, canonicalBranch, worktreePath, {
      workspacePaneRoute,
    })
  }
  if (!target) return false
  if (routeTarget.kind === 'workspace-root') {
    const tab = target.tabs.find(
      (candidate) => candidate.identity === terminalWorkspacePaneTabProvider.identity(sessionId),
    )
    if (!tab) return false
    return navigation.commitWorkspaceRootTerminalSession(
      workspaceId,
      target.workspaceRuntimeId,
      sessionId,
      routeRequest,
    )
  }
  return commitWorkspacePaneCommittedRuntimeTargetRoute(
    target,
    { kind: 'terminal', terminalSessionId: sessionId },
    navigation,
    undefined,
    routeRequest.navigationGeneration,
  )
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
    const navigationGeneration = beginPrimaryWindowNavigation()
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
    routeTarget: terminal.routeTarget,
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
    routeTarget: terminal.routeTarget,
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
    branchName: workspaceRoot ? null : terminalPresentationBranch(base.presentation),
    worktreePath: workspaceRoot ? null : terminalExecutionPath(base.target),
  })
}

function existingTerminalPresentationRouteRequest(
  navigationGeneration: PrimaryWindowNavigationGeneration,
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
