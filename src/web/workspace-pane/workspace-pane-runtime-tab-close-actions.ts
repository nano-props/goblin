import { isShellProcessName } from '#/shared/terminal-process-name.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabCloseOutcome } from '#/web/workspace-pane/workspace-pane-tab-close-outcome.ts'
import { workspacePaneRuntimeTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import type { WorkspacePaneRuntimeTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'

export interface WorkspacePaneRuntimeTabCloseConfirmInput {
  type: 'terminal'
  identity: string
  sessionId: string
  view: WorkspacePaneRuntimeTabSummary
  target: TerminalSessionBase
}

export interface WorkspacePaneRuntimeTabCloseConfirmRequest {
  type: 'terminal'
  identity: string
  sessionId: string
  target: TerminalSessionBase
  processName?: string
}

export interface ConfirmedWorkspacePaneRuntimeTabClose {
  type: 'terminal'
  sessionId: string
  target: TerminalSessionBase
}

export interface TerminalWorkspacePaneRuntimeTabCloseContext {
  closeTerminalByDescriptor: (
    terminalSessionId: string,
    base: TerminalSessionBase,
  ) => Promise<WorkspacePaneTabCloseOutcome>
}

export function workspacePaneRuntimeTabCloseConfirmRequest(
  input: WorkspacePaneRuntimeTabCloseConfirmInput,
): WorkspacePaneRuntimeTabCloseConfirmRequest | null {
  return terminalCloseConfirmRequest(input)
}

export async function confirmWorkspacePaneRuntimeTabClose(
  confirmed: ConfirmedWorkspacePaneRuntimeTabClose,
  context: TerminalWorkspacePaneRuntimeTabCloseContext,
): Promise<WorkspacePaneTabCloseOutcome> {
  return await confirmTerminalClose(confirmed, context)
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
  context: TerminalWorkspacePaneRuntimeTabCloseContext,
): Promise<WorkspacePaneTabCloseOutcome> {
  return await context.closeTerminalByDescriptor(confirmed.sessionId, confirmed.target)
}
