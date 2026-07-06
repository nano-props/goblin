import { isShellProcessName } from '#/shared/terminal-process-name.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { workspacePaneRuntimeTabProvider } from '#/web/components/workspace-pane/tab-providers.ts'
import type { WorkspacePaneRuntimeTabSummary } from '#/web/components/workspace-pane/workspace-pane-tab-summary.ts'

export interface WorkspacePaneRuntimeTabCloseTarget {
  repoRoot: string
  branchName: string | null
  worktreePath: string | null
}

export interface WorkspacePaneRuntimeTabCloseConfirmInput {
  type: WorkspacePaneRuntimeTabType
  identity: string
  sessionId: string
  view: WorkspacePaneRuntimeTabSummary
  target: WorkspacePaneRuntimeTabCloseTarget
}

export interface WorkspacePaneRuntimeTabCloseConfirmRequest {
  type: WorkspacePaneRuntimeTabType
  identity: string
  sessionId: string
  target: WorkspacePaneRuntimeTabCloseTarget
  processName?: string
}

export interface ConfirmedWorkspacePaneRuntimeTabClose {
  type: WorkspacePaneRuntimeTabType
  sessionId: string
  target: WorkspacePaneRuntimeTabCloseTarget
}

export interface WorkspacePaneRuntimeTabCloseContext {
  byType: Partial<Record<WorkspacePaneRuntimeTabType, unknown>>
}

export interface TerminalWorkspacePaneRuntimeTabCloseContext {
  closeTerminalByDescriptor?: (terminalSessionId: string, base: TerminalSessionBase) => Promise<boolean>
  closeTerminalsForWorktree?: (base: TerminalSessionBase) => Promise<boolean>
}

interface WorkspacePaneRuntimeTabCloseActions {
  closeConfirmRequest: (
    input: WorkspacePaneRuntimeTabCloseConfirmInput,
  ) => WorkspacePaneRuntimeTabCloseConfirmRequest | null
  confirmClose: (
    confirmed: ConfirmedWorkspacePaneRuntimeTabClose,
    context: WorkspacePaneRuntimeTabCloseContext,
  ) => Promise<boolean>
  closeWorktree: (
    target: WorkspacePaneRuntimeTabCloseTarget,
    context: WorkspacePaneRuntimeTabCloseContext,
  ) => Promise<boolean>
  confirmedBranchName: (confirmed: ConfirmedWorkspacePaneRuntimeTabClose) => string | null
}

const WORKSPACE_PANE_RUNTIME_TAB_CLOSE_ACTIONS_BY_TYPE: Record<
  WorkspacePaneRuntimeTabType,
  WorkspacePaneRuntimeTabCloseActions
> = {
  terminal: {
    closeConfirmRequest: terminalCloseConfirmRequest,
    confirmClose: confirmTerminalClose,
    closeWorktree: closeTerminalWorktree,
    confirmedBranchName: terminalConfirmedBranchName,
  },
}

export function workspacePaneRuntimeTabCloseConfirmRequest(
  input: WorkspacePaneRuntimeTabCloseConfirmInput,
): WorkspacePaneRuntimeTabCloseConfirmRequest | null {
  return WORKSPACE_PANE_RUNTIME_TAB_CLOSE_ACTIONS_BY_TYPE[input.type].closeConfirmRequest(input)
}

export async function confirmWorkspacePaneRuntimeTabClose(
  confirmed: ConfirmedWorkspacePaneRuntimeTabClose,
  context: WorkspacePaneRuntimeTabCloseContext,
): Promise<boolean> {
  return await WORKSPACE_PANE_RUNTIME_TAB_CLOSE_ACTIONS_BY_TYPE[confirmed.type].confirmClose(confirmed, context)
}

export function workspacePaneRuntimeTabConfirmedCloseBranchName(
  confirmed: ConfirmedWorkspacePaneRuntimeTabClose,
): string | null {
  return WORKSPACE_PANE_RUNTIME_TAB_CLOSE_ACTIONS_BY_TYPE[confirmed.type].confirmedBranchName(confirmed)
}

export async function closeWorkspacePaneRuntimeTabsForWorktree(
  type: WorkspacePaneRuntimeTabType,
  target: WorkspacePaneRuntimeTabCloseTarget,
  context: WorkspacePaneRuntimeTabCloseContext,
): Promise<boolean> {
  return await WORKSPACE_PANE_RUNTIME_TAB_CLOSE_ACTIONS_BY_TYPE[type].closeWorktree(target, context)
}

export function workspacePaneRuntimeTabConfirmedCloseIdentity(
  confirmed: ConfirmedWorkspacePaneRuntimeTabClose,
): string {
  return workspacePaneRuntimeTabProvider(confirmed.type).identity(confirmed.sessionId)
}

function terminalCloseConfirmRequest(
  input: WorkspacePaneRuntimeTabCloseConfirmInput,
): WorkspacePaneRuntimeTabCloseConfirmRequest | null {
  if (input.view.type !== 'terminal') return null
  if (!terminalBaseForRuntimeTabCloseTarget(input.target)) return null
  if (input.view.phase !== 'open') return null
  const processName = input.view.processName?.trim()
  if (!processName || isShellProcessName(processName)) return null
  return {
    type: 'terminal',
    identity: input.identity,
    sessionId: input.sessionId,
    target: input.target,
    processName,
  }
}

async function confirmTerminalClose(
  confirmed: ConfirmedWorkspacePaneRuntimeTabClose,
  context: WorkspacePaneRuntimeTabCloseContext,
): Promise<boolean> {
  const terminalBase = terminalBaseForRuntimeTabCloseTarget(confirmed.target)
  if (!terminalBase) return false
  const closeTerminalByDescriptor = terminalRuntimeTabCloseContext(context)?.closeTerminalByDescriptor
  if (!closeTerminalByDescriptor) return false
  return await closeTerminalByDescriptor(confirmed.sessionId, terminalBase)
}

async function closeTerminalWorktree(
  target: WorkspacePaneRuntimeTabCloseTarget,
  context: WorkspacePaneRuntimeTabCloseContext,
): Promise<boolean> {
  const terminalBase = terminalBaseForRuntimeTabCloseTarget(target)
  if (!terminalBase) return true
  const closeTerminalsForWorktree = terminalRuntimeTabCloseContext(context)?.closeTerminalsForWorktree
  if (!closeTerminalsForWorktree) return true
  return await closeTerminalsForWorktree(terminalBase)
}

function terminalConfirmedBranchName(confirmed: ConfirmedWorkspacePaneRuntimeTabClose): string | null {
  return confirmed.target.branchName
}

export function terminalRuntimeTabCloseContext(
  context: WorkspacePaneRuntimeTabCloseContext,
): TerminalWorkspacePaneRuntimeTabCloseContext | undefined {
  return context.byType.terminal as TerminalWorkspacePaneRuntimeTabCloseContext | undefined
}

export function terminalBaseForRuntimeTabCloseTarget(
  target: WorkspacePaneRuntimeTabCloseTarget,
): TerminalSessionBase | null {
  if (!target.branchName || !target.worktreePath) return null
  return {
    repoRoot: target.repoRoot,
    branch: target.branchName,
    worktreePath: target.worktreePath,
  }
}
