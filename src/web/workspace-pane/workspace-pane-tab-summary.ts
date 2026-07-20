import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { TerminalSessionSummary } from '#/web/components/terminal/types.ts'

export type WorkspacePaneTerminalTabSummary = TerminalSessionSummary
export interface WorkspacePaneGenericRuntimeTabSummary<
  TType extends WorkspacePaneRuntimeTabType = Exclude<WorkspacePaneRuntimeTabType, 'terminal'>,
> {
  type: TType
  runtimeSessionId: string
}
export type WorkspacePaneNonTerminalRuntimeTabSummary = {
  [TType in Exclude<WorkspacePaneRuntimeTabType, 'terminal'>]: WorkspacePaneGenericRuntimeTabSummary<TType>
}[Exclude<WorkspacePaneRuntimeTabType, 'terminal'>]
export type WorkspacePaneRuntimeTabSummary = WorkspacePaneTerminalTabSummary | WorkspacePaneNonTerminalRuntimeTabSummary
export type WorkspacePaneTabSummary = WorkspacePaneRuntimeTabSummary

type WorkspacePaneRuntimeTabSummaryWithGenericId =
  WorkspacePaneRuntimeTabSummary | WorkspacePaneGenericRuntimeTabSummary<WorkspacePaneRuntimeTabType>

export function workspacePanePendingRuntimeTabIdentity(type: WorkspacePaneRuntimeTabType): string {
  return `${type}:pending`
}

export function workspacePaneRuntimeTabSummarySessionId(view: WorkspacePaneRuntimeTabSummaryWithGenericId): string {
  if ('runtimeSessionId' in view) return view.runtimeSessionId
  if (view.type === 'terminal') return view.terminalSessionId
  throw new Error(`Unhandled workspace pane runtime tab summary: ${String(view.type)}`)
}

export function workspacePaneRuntimeTabSummaryIdentity(view: WorkspacePaneRuntimeTabSummaryWithGenericId): string {
  return `${view.type}:${workspacePaneRuntimeTabSummarySessionId(view)}`
}
