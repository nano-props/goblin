import { isShellProcessName } from '#/shared/terminal-process-name.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { workspacePaneRuntimeTabProvider } from '#/web/components/workspace-pane/tab-providers.ts'
import type { WorkspacePaneRuntimeTabSummary } from '#/web/components/workspace-pane/workspace-pane-tab-summary.ts'

export interface WorkspacePaneRuntimeTabCloseConfirmInput {
  type: WorkspacePaneRuntimeTabType
  identity: string
  sessionId: string
  view: WorkspacePaneRuntimeTabSummary
  terminalBase?: TerminalSessionBase | null
}

export interface WorkspacePaneRuntimeTabCloseConfirmRequest {
  type: WorkspacePaneRuntimeTabType
  identity: string
  sessionId: string
  terminalBase?: TerminalSessionBase
  processName?: string
}

export interface ConfirmedWorkspacePaneRuntimeTabClose {
  type: WorkspacePaneRuntimeTabType
  sessionId: string
  terminalBase?: TerminalSessionBase
}

export interface WorkspacePaneRuntimeTabCloseContext {
  terminal?: {
    closeTerminalByDescriptor?: (terminalSessionId: string, base: TerminalSessionBase) => Promise<boolean>
    closeTerminalsForWorktree?: (base: TerminalSessionBase) => Promise<boolean>
  }
}

interface WorkspacePaneRuntimeTabCloseActions {
  closeConfirmRequest: (
    input: WorkspacePaneRuntimeTabCloseConfirmInput,
  ) => WorkspacePaneRuntimeTabCloseConfirmRequest | null
  confirmClose: (
    confirmed: ConfirmedWorkspacePaneRuntimeTabClose,
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

export function workspacePaneRuntimeTabConfirmedCloseIdentity(
  confirmed: ConfirmedWorkspacePaneRuntimeTabClose,
): string {
  return workspacePaneRuntimeTabProvider(confirmed.type).identity(confirmed.sessionId)
}

function terminalCloseConfirmRequest(
  input: WorkspacePaneRuntimeTabCloseConfirmInput,
): WorkspacePaneRuntimeTabCloseConfirmRequest | null {
  if (input.view.type !== 'terminal') return null
  if (!input.terminalBase) return null
  if (input.view.phase !== 'open') return null
  const processName = input.view.processName?.trim()
  if (!processName || isShellProcessName(processName)) return null
  return {
    type: 'terminal',
    identity: input.identity,
    sessionId: input.sessionId,
    terminalBase: input.terminalBase,
    processName,
  }
}

async function confirmTerminalClose(
  confirmed: ConfirmedWorkspacePaneRuntimeTabClose,
  context: WorkspacePaneRuntimeTabCloseContext,
): Promise<boolean> {
  if (!confirmed.terminalBase) return false
  const closeTerminalByDescriptor = context.terminal?.closeTerminalByDescriptor
  if (!closeTerminalByDescriptor) return false
  return await closeTerminalByDescriptor(confirmed.sessionId, confirmed.terminalBase)
}

function terminalConfirmedBranchName(confirmed: ConfirmedWorkspacePaneRuntimeTabClose): string | null {
  return confirmed.terminalBase?.branch ?? null
}
