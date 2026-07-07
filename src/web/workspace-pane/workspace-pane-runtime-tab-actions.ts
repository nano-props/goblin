import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneRuntimeTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'

export interface WorkspacePaneRuntimeTabActionContext {
  enterRuntimeTab: (type: WorkspacePaneRuntimeTabType) => void
  terminal?: {
    selectTerminal?: (terminalWorktreeKey: string, terminalSessionId: string) => void
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
  context.enterRuntimeTab('terminal')
  context.terminal?.selectTerminal?.(view.terminalWorktreeKey, view.terminalSessionId)
  return true
}

function reselectTerminalRuntimeTab(
  view: WorkspacePaneRuntimeTabSummary,
  context: WorkspacePaneRuntimeTabActionContext,
): boolean {
  if (view.type !== 'terminal') return false
  context.enterRuntimeTab('terminal')
  context.terminal?.scrollToBottom?.(view.terminalSessionId)
  return true
}
