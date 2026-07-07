import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneRuntimeTabSummary } from '#/web/components/workspace-pane/workspace-pane-tab-summary.ts'

export interface WorkspacePaneRuntimeTabActionContext {
  showRuntimeTab: (type: WorkspacePaneRuntimeTabType, sessionId: string) => void
  terminal?: {
    scrollToBottom?: (terminalSessionId: string) => void
  }
}

interface WorkspacePaneRuntimeTabActions {
  select: (view: WorkspacePaneRuntimeTabSummary, context: WorkspacePaneRuntimeTabActionContext) => boolean
  reselect: (view: WorkspacePaneRuntimeTabSummary, context: WorkspacePaneRuntimeTabActionContext) => boolean
}

const WORKSPACE_PANE_RUNTIME_TAB_ACTIONS_BY_TYPE: Record<WorkspacePaneRuntimeTabType, WorkspacePaneRuntimeTabActions> =
  {
    terminal: {
      select: selectTerminalRuntimeTab,
      reselect: reselectTerminalRuntimeTab,
    },
  }

export function selectWorkspacePaneRuntimeTab(
  view: WorkspacePaneRuntimeTabSummary,
  context: WorkspacePaneRuntimeTabActionContext,
): boolean {
  return WORKSPACE_PANE_RUNTIME_TAB_ACTIONS_BY_TYPE[view.type].select(view, context)
}

export function reselectWorkspacePaneRuntimeTab(
  view: WorkspacePaneRuntimeTabSummary,
  context: WorkspacePaneRuntimeTabActionContext,
): boolean {
  return WORKSPACE_PANE_RUNTIME_TAB_ACTIONS_BY_TYPE[view.type].reselect(view, context)
}

function selectTerminalRuntimeTab(
  view: WorkspacePaneRuntimeTabSummary,
  context: WorkspacePaneRuntimeTabActionContext,
): boolean {
  if (view.type !== 'terminal') return false
  context.showRuntimeTab('terminal', view.terminalSessionId)
  return true
}

function reselectTerminalRuntimeTab(
  view: WorkspacePaneRuntimeTabSummary,
  context: WorkspacePaneRuntimeTabActionContext,
): boolean {
  if (view.type !== 'terminal') return false
  context.showRuntimeTab('terminal', view.terminalSessionId)
  context.terminal?.scrollToBottom?.(view.terminalSessionId)
  return true
}
