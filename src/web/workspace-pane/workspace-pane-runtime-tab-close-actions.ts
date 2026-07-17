import { isShellProcessName } from '#/shared/terminal-process-name.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { workspacePaneRuntimeTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import type { WorkspacePaneRuntimeTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import { runtimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-target.ts'

export interface WorkspacePaneRuntimeTabCloseTarget {
  repoRoot: string
  repoRuntimeId: string
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
}

interface WorkspacePaneRuntimeTabCloseActions {
  closeConfirmRequest: (
    input: WorkspacePaneRuntimeTabCloseConfirmInput,
  ) => WorkspacePaneRuntimeTabCloseConfirmRequest | null
  confirmClose: (
    confirmed: ConfirmedWorkspacePaneRuntimeTabClose,
    context: WorkspacePaneRuntimeTabCloseContext,
  ) => Promise<boolean>
}

const WORKSPACE_PANE_RUNTIME_TAB_CLOSE_ACTIONS_BY_TYPE: Record<
  WorkspacePaneRuntimeTabType,
  WorkspacePaneRuntimeTabCloseActions
> = {
  terminal: {
    closeConfirmRequest: terminalCloseConfirmRequest,
    confirmClose: confirmTerminalClose,
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

export function terminalRuntimeTabCloseContext(
  context: WorkspacePaneRuntimeTabCloseContext,
): TerminalWorkspacePaneRuntimeTabCloseContext | undefined {
  return context.byType.terminal as TerminalWorkspacePaneRuntimeTabCloseContext | undefined
}

export function terminalBaseForRuntimeTabCloseTarget(
  target: WorkspacePaneRuntimeTabCloseTarget,
): TerminalSessionBase | null {
  if (!target.worktreePath) return null
  const runtimeTarget = runtimeWorkspacePaneTarget(
    target.branchName === null
      ? { kind: 'workspace-root', repoRoot: target.repoRoot, branchName: null, worktreePath: null }
      : { repoRoot: target.repoRoot, branchName: target.branchName, worktreePath: target.worktreePath },
    target.repoRuntimeId,
  )
  if (!runtimeTarget || (runtimeTarget.kind !== 'workspace-root' && !target.branchName)) return null
  return {
    repoRoot: target.repoRoot,
    repoRuntimeId: target.repoRuntimeId,
    branch: target.branchName ?? '',
    worktreePath: target.worktreePath,
    target: runtimeTarget,
  }
}
