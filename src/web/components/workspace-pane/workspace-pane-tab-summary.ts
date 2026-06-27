import type { WorkspacePaneTabSummary, TerminalSessionSummary } from '#/web/components/terminal/types.ts'

export const PENDING_TERMINAL_WORKSPACE_PANE_VIEW_IDENTITY = 'terminal:pending'

export function isTerminalWorkspacePaneView(tab: WorkspacePaneTabSummary): tab is TerminalSessionSummary {
  return tab.type === 'terminal'
}
