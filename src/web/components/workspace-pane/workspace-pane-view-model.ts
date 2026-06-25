import type { WorkspacePaneViewSummary, TerminalSlotSummary } from '#/web/components/terminal/types.ts'

export const PENDING_TERMINAL_WORKSPACE_PANE_VIEW_IDENTITY = 'terminal:pending'

export function isTerminalWorkspacePaneView(tab: WorkspacePaneViewSummary): tab is TerminalSlotSummary {
  return tab.type === 'terminal'
}
