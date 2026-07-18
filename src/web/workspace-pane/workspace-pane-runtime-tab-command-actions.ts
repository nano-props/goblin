import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import {
  terminalExecutionCoordinates,
  terminalExecutionPath,
  terminalPresentationBranch,
  type TerminalPresentation,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import type { TerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
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
  workspacePaneTabTargetForWorkspace,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { workspacePaneRuntimeTabCommandContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-command-context.ts'
import { dispatchCreateTerminalWorkspacePaneRuntimeTabAction } from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import { terminalWorkspacePaneTabProvider } from '#/web/workspace-pane/tab-providers.ts'

export interface WorkspacePaneRuntimeTabCommandContext {
  terminal?: {
    base: TerminalSessionBase | null
    bridge: TerminalSessionCommandBridge | null
    openerIdentity: string | null
    showTerminalSession: (terminalSessionId: string) => boolean | Promise<boolean>
    showCreatedTerminalSession: (terminalSessionId: string, presentation: TerminalPresentation) => boolean | Promise<boolean>
    t?: TerminalCreateTranslator
  }
}

export interface WorkspacePaneTerminalRuntimeCommandOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
  navigation: WorkspacePaneTabControllerCommitNavigation
  t?: TerminalCreateTranslator
}

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
  if (!options.repoId) return false
  return await terminalRuntimePrimaryAction(options)
}

async function terminalRuntimePrimaryAction({
  repoId,
  branchName,
  workspacePaneRoute,
  navigation,
  t,
}: WorkspacePaneTerminalRuntimeCommandOptions): Promise<boolean> {
  if (!repoId) return false
  return await runWorkspacePaneRuntimePrimaryAction(
    'terminal',
    workspacePaneRuntimeTabCommandContext({
      repoId,
      branchName,
      workspacePaneRoute,
      showRuntimeTab: (type, sessionId) =>
        showTerminalRuntimeTab(type, sessionId, repoId, branchName, workspacePaneRoute, navigation),
      showCreatedRuntimeTab: (type, sessionId, presentation, worktreePath) =>
        showCreatedTerminalRuntimeTab(
          type,
          sessionId,
          repoId,
          branchName,
          presentation,
          worktreePath,
          workspacePaneRoute,
          navigation,
        ),
      terminalCreateTranslator: t,
    }),
  )
}

export async function dispatchNewTerminalRuntimeTabAction(
  options: WorkspacePaneTerminalRuntimeCommandOptions,
): Promise<boolean> {
  const { repoId, branchName } = options
  if (!repoId) return false
  const context = newTerminalRuntimeTabActionContext({ ...options, repoId })
  return await runWorkspacePaneRuntimeNewAction('terminal', context)
}

function newTerminalRuntimeTabActionContext({
  repoId,
  branchName,
  workspacePaneRoute,
  navigation,
  t,
}: WorkspacePaneTerminalRuntimeCommandOptions & { repoId: string }): WorkspacePaneRuntimeTabCommandContext {
  return workspacePaneRuntimeTabCommandContext({
    repoId,
    branchName,
    workspacePaneRoute,
    showRuntimeTab: (type, sessionId) =>
      showTerminalRuntimeTab(type, sessionId, repoId, branchName, workspacePaneRoute, navigation),
    showCreatedRuntimeTab: (type, sessionId, presentation, worktreePath) =>
      showCreatedTerminalRuntimeTab(
        type,
        sessionId,
        repoId,
        branchName,
        presentation,
        worktreePath,
        workspacePaneRoute,
        navigation,
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

function showTerminalRuntimeTab(
  type: WorkspacePaneRuntimeTabType,
  sessionId: string,
  repoId: string,
  branchName: string | null,
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined,
  navigation: WorkspacePaneTabControllerCommitNavigation,
): boolean | Promise<boolean> {
  if (type !== 'terminal') return false
  const target = branchName
    ? workspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute })
    : workspacePaneTabTargetForWorkspace(repoId, { workspacePaneRoute })
  if (!target) return false
  if (branchName === null) {
    const tab = target.tabs.find(
      (candidate) => candidate.identity === terminalWorkspacePaneTabProvider.identity(sessionId),
    )
    return tab ? selectWorkspacePaneControllerTab(target, tab, navigation) : false
  }
  return commitWorkspacePaneCurrentTargetRoute(target, { kind: 'terminal', terminalSessionId: sessionId }, navigation)
}

function showCreatedTerminalRuntimeTab(
  type: WorkspacePaneRuntimeTabType,
  sessionId: string,
  repoId: string,
  sourceBranchName: string | null,
  presentation: TerminalPresentation,
  worktreePath: string,
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined,
  navigation: WorkspacePaneTabControllerCommitNavigation,
): boolean | Promise<boolean> {
  if (type !== 'terminal') return false
  let target
  if (sourceBranchName === null) {
    if (presentation.kind !== 'workspace-root') return false
    target = workspacePaneTabTargetForWorkspace(repoId, { workspacePaneRoute })
  } else {
    if (presentation.kind !== 'git-worktree') return false
    target = workspacePaneTabTargetForCreatedRuntime(repoId, presentation.branchName, worktreePath, {
      workspacePaneRoute,
    })
  }
  if (!target) return false
  if (sourceBranchName === null) {
    const tab = target.tabs.find(
      (candidate) => candidate.identity === terminalWorkspacePaneTabProvider.identity(sessionId),
    )
    return tab ? selectWorkspacePaneControllerTab(target, tab, navigation) : false
  }
  return commitWorkspacePaneCommittedRuntimeTargetRoute(
    target,
    { kind: 'terminal', terminalSessionId: sessionId },
    navigation,
  )
}

async function runTerminalPrimaryAction(context: WorkspacePaneRuntimeTabCommandContext): Promise<boolean> {
  const terminal = context.terminal
  if (!terminal?.base) return false
  if (!terminal.bridge) return false
  const { base, bridge } = terminal
  const coordinates = terminalExecutionCoordinates(base.target)
  const terminalWorktreeKey = formatTerminalWorktreeKey(coordinates.repoRoot, coordinates.worktreeId)
  const worktree = bridge.terminalWorktreeSnapshot(terminalWorktreeKey)
  if (worktree.createPending) return true
  if (worktree.count > 0) {
    const target = terminalCoordinatorTarget(base)
    if (!target) return false
    return await runWorkspacePaneAction(target, async () => {
      const nextWorktree = bridge.terminalWorktreeSnapshot(terminalWorktreeKey)
      if (nextWorktree.createPending) return true
      const firstSession = nextWorktree.sessions[0]
      return firstSession ? await terminal.showTerminalSession(firstSession.terminalSessionId) : false
    })
  }
  const result = await dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
    base,
    createTerminal: bridge.createTerminalWithAdmission,
    openerIdentity: terminal.openerIdentity,
    showCreatedTerminalTab: terminal.showCreatedTerminalSession,
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
    showCreatedTerminalTab: terminal.showCreatedTerminalSession,
    t: terminal.t,
  })
  return result.ok
}

function terminalCoordinatorTarget(base: TerminalSessionBase): WorkspacePaneActionTarget | null {
  const coordinates = terminalExecutionCoordinates(base.target)
  const workspaceRoot = base.target.kind === 'workspace-root'
  return workspacePaneActionTargetFromCoordinates({
    repoId: coordinates.repoRoot,
    repoRuntimeId: coordinates.repoRuntimeId,
    branchName: workspaceRoot ? null : terminalPresentationBranch(base.presentation),
    worktreePath: workspaceRoot ? null : terminalExecutionPath(base.target),
  })
}
