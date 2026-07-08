import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { runCreateTerminalTabCommand } from '#/web/commands/terminal-create-command.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import type { TerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'

export interface WorkspacePaneRuntimeTabCommandContext {
  terminal?: {
    base: TerminalSessionBase | null
    bridge: TerminalSessionCommandBridge | null
    openerIdentity: string | null
    showTerminalSession: (terminalSessionId: string) => boolean | Promise<boolean>
    t?: TerminalCreateTranslator
  }
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

async function runTerminalPrimaryAction(context: WorkspacePaneRuntimeTabCommandContext): Promise<boolean> {
  const terminal = context.terminal
  if (!terminal?.base) return false
  if (!terminal.bridge) return false
  const terminalWorktreeKey = formatTerminalWorktreeKey(terminal.base.repoRoot, terminal.base.worktreePath)
  // Synchronous local-state read (no network round trip), so there's no
  // responsiveness cost to deciding before switching views.
  const worktree = terminal.bridge.terminalWorktreeSnapshot(terminalWorktreeKey)
  if (worktree.createPending) return true
  if (worktree.count > 0) {
    // The primary action should land on a working runtime session when one
    // already exists instead of leaving selection wherever it previously was.
    const firstSession = worktree.sessions[0]
    return firstSession ? await terminal.showTerminalSession(firstSession.terminalSessionId) : false
  }
  const result = await runCreateTerminalTabCommand({
    base: terminal.base,
    createTerminal: terminal.bridge.createTerminal,
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
  const terminalWorktreeKey = formatTerminalWorktreeKey(terminal.base.repoRoot, terminal.base.worktreePath)
  if (terminal.bridge.terminalWorktreeSnapshot(terminalWorktreeKey).createPending) return true
  const result = await runCreateTerminalTabCommand({
    base: terminal.base,
    createTerminal: terminal.bridge.createTerminal,
    openerIdentity: terminal.openerIdentity,
    showCreatedTerminalTab: terminal.showTerminalSession,
    t: terminal.t,
  })
  return result.ok
}
