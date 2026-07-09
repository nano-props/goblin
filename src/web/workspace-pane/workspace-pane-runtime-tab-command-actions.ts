import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { runCreateTerminalTabCommand } from '#/web/commands/terminal-create-command.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import type { TerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspacePaneTabControllerNavigation } from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { showWorkspacePaneControllerRoute } from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { workspacePaneRuntimeTabCommandContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-command-context.ts'
import { withWorkspacePaneTerminalCreateCoordination } from '#/web/workspace-pane/workspace-pane-terminal-create-coordination.ts'

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
  workspacePaneRoute: RepoBranchWorkspacePaneRoute | null | undefined
  navigation: WorkspacePaneTabControllerNavigation
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
  navigation: WorkspacePaneTabControllerNavigation,
): boolean {
  if (type !== 'terminal') return false
  return showWorkspacePaneControllerRoute(repoId, branchName, { kind: 'terminal', terminalSessionId: sessionId }, navigation)
}

async function runTerminalPrimaryAction(context: WorkspacePaneRuntimeTabCommandContext): Promise<boolean> {
  const terminal = context.terminal
  if (!terminal?.base) return false
  if (!terminal.bridge) return false
  const terminalWorktreeKey = formatTerminalWorktreeKey(terminal.base.repoRoot, terminal.base.worktreePath)
  const worktree = terminal.bridge.terminalWorktreeSnapshot(terminalWorktreeKey)
  if (worktree.count > 0) {
    // The primary action should land on a working runtime session when one
    // already exists instead of leaving selection wherever it previously was.
    const firstSession = worktree.sessions[0]
    return firstSession ? await terminal.showTerminalSession(firstSession.terminalSessionId) : false
  }
  if (worktree.createPending) return true
  const result = await runCreateTerminalTabCommand({
    base: terminal.base,
    createTerminal: terminal.bridge.createTerminal,
    options: withWorkspacePaneTerminalCreateCoordination(terminal.base),
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
  const result = await runCreateTerminalTabCommand({
    base: terminal.base,
    createTerminal: terminal.bridge.createTerminal,
    options: withWorkspacePaneTerminalCreateCoordination(terminal.base),
    openerIdentity: terminal.openerIdentity,
    showCreatedTerminalTab: terminal.showTerminalSession,
    t: terminal.t,
  })
  return result.ok
}
