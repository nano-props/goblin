import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { TerminalSessionSummary } from '#/web/components/terminal/types.ts'

export type WorkspacePaneTerminalTabSummary = TerminalSessionSummary
export type WorkspacePaneRuntimeTabSummary = WorkspacePaneTerminalTabSummary
export type WorkspacePaneTabSummary = WorkspacePaneRuntimeTabSummary

export function workspacePanePendingRuntimeTabIdentity(type: WorkspacePaneRuntimeTabType): string {
  return `${type}:pending`
}

export function workspacePaneRuntimeTabSummarySessionId(view: WorkspacePaneRuntimeTabSummary): string {
  return view.terminalSessionId
}

export function workspacePaneRuntimeTabSummaryIdentity(view: WorkspacePaneRuntimeTabSummary): string {
  return `${view.type}:${workspacePaneRuntimeTabSummarySessionId(view)}`
}
