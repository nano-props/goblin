import { useMemo } from 'react'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import { createWorkspacePaneRuntimeTabActionContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-action-context.ts'
import type { WorkspacePaneRuntimeTabActionContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-actions.ts'

export interface UseWorkspacePaneRuntimeTabActionContextInput {
  enterRuntimeTab: (type: WorkspacePaneRuntimeTabType) => void
}

export function useWorkspacePaneRuntimeTabActionContext({
  enterRuntimeTab,
}: UseWorkspacePaneRuntimeTabActionContextInput): WorkspacePaneRuntimeTabActionContext {
  const { selectTerminal, scrollToBottom } = useTerminalSessionContext()
  return useMemo(
    () =>
      createWorkspacePaneRuntimeTabActionContext({
        enterRuntimeTab,
        terminal: {
          selectTerminal,
          scrollToBottom,
        },
      }),
    [enterRuntimeTab, scrollToBottom, selectTerminal],
  )
}
