import { useMemo } from 'react'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import { createWorkspacePaneRuntimeTabActionContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-action-context.ts'
import type { WorkspacePaneRuntimeTabActionContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-actions.ts'

export interface UseWorkspacePaneRuntimeTabActionContextInput {
  showRuntimeTab: (type: WorkspacePaneRuntimeTabType, sessionId: string) => boolean
}

export function useWorkspacePaneRuntimeTabActionContext({
  showRuntimeTab,
}: UseWorkspacePaneRuntimeTabActionContextInput): WorkspacePaneRuntimeTabActionContext {
  const { scrollToBottom } = useTerminalSessionContext()
  return useMemo(
    () =>
      createWorkspacePaneRuntimeTabActionContext({
        showRuntimeTab,
        terminal: {
          scrollToBottom,
        },
      }),
    [showRuntimeTab, scrollToBottom],
  )
}
