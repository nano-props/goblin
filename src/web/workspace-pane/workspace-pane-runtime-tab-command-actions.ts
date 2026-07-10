import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import type { TerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspacePaneTabControllerCommitNavigation } from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { commitWorkspacePaneControllerRoute } from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { runWorkspacePaneTabCoordinatorTask } from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'
import { workspacePaneRuntimeTabCommandContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-command-context.ts'
import { dispatchCreateTerminalWorkspacePaneRuntimeTabAction } from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'

export interface WorkspacePaneRuntimeTabCommandContext {
  terminal?: {
    base: TerminalSessionBase | null
    bridge: TerminalSessionCommandBridge | null
    openerIdentity: string | null
    showTerminalSession: (terminalSessionId: string) => boolean | Promise<boolean>
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

type ResolvedWorkspacePaneTerminalRuntimeCommandOptions = WorkspacePaneTerminalRuntimeCommandOptions & {
  repoId: string
  branchName: string
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
  if (!options.repoId || !options.branchName) return false
  return await terminalRuntimePrimaryAction(options)
}

async function terminalRuntimePrimaryAction({
  repoId,
  branchName,
  workspacePaneRoute,
  navigation,
  t,
}: WorkspacePaneTerminalRuntimeCommandOptions): Promise<boolean> {
  if (!repoId || !branchName) return false
  return await runWorkspacePaneRuntimePrimaryAction(
    'terminal',
    workspacePaneRuntimeTabCommandContext({
      repoId,
      branchName,
      workspacePaneRoute,
      showRuntimeTab: (type, sessionId) => showTerminalRuntimeTab(type, sessionId, repoId, branchName, navigation),
      terminalCreateTranslator: t,
    }),
  )
}

export async function dispatchNewTerminalRuntimeTabAction(
  options: WorkspacePaneTerminalRuntimeCommandOptions,
): Promise<boolean> {
  const { repoId, branchName } = options
  if (!repoId || !branchName) return false
  const context = newTerminalRuntimeTabActionContext({ ...options, repoId, branchName })
  return await runWorkspacePaneRuntimeNewAction('terminal', context)
}

function newTerminalRuntimeTabActionContext({
  repoId,
  branchName,
  workspacePaneRoute,
  navigation,
  t,
}: ResolvedWorkspacePaneTerminalRuntimeCommandOptions): WorkspacePaneRuntimeTabCommandContext {
  return workspacePaneRuntimeTabCommandContext({
    repoId,
    branchName,
    workspacePaneRoute,
    showRuntimeTab: (type, sessionId) => showTerminalRuntimeTab(type, sessionId, repoId, branchName, navigation),
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
  branchName: string,
  navigation: WorkspacePaneTabControllerCommitNavigation,
): boolean | Promise<boolean> {
  if (type !== 'terminal') return false
  return commitWorkspacePaneControllerRoute(
    repoId,
    branchName,
    { kind: 'terminal', terminalSessionId: sessionId },
    navigation,
  )
}

async function runTerminalPrimaryAction(context: WorkspacePaneRuntimeTabCommandContext): Promise<boolean> {
  const terminal = context.terminal
  if (!terminal?.base) return false
  if (!terminal.bridge) return false
  const { base, bridge } = terminal
  const terminalWorktreeKey = formatTerminalWorktreeKey(base.repoRoot, base.worktreePath)
  const worktree = bridge.terminalWorktreeSnapshot(terminalWorktreeKey)
  if (worktree.createPending) return true
  if (worktree.count > 0) {
    return await runWorkspacePaneTabCoordinatorTask(terminalCoordinatorTarget(base), async () => {
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
    showCreatedTerminalTab: terminal.showTerminalSession,
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
    showCreatedTerminalTab: terminal.showTerminalSession,
    t: terminal.t,
  })
  return result.ok
}

function terminalCoordinatorTarget(base: TerminalSessionBase): {
  repoId: string
  branchName: string
  worktreePath: string
} {
  return { repoId: base.repoRoot, branchName: base.branch, worktreePath: base.worktreePath }
}
