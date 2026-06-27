import type { WorkspacePaneTabSummary, TerminalSessionSummary } from '#/web/components/terminal/types.ts'

export const PENDING_TERMINAL_WORKSPACE_PANE_TAB_IDENTITY = 'terminal:pending'

export function isTerminalWorkspacePaneTab(tab: WorkspacePaneTabSummary): tab is TerminalSessionSummary {
  return tab.type === 'terminal'
}
