import { useEffect, useRef } from 'react'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { requestVisibleWorkspaceStatusRefresh } from '#/web/stores/workspaces/repo-refresh-actions.ts'
import { workspacePaneTabProvider } from '#/web/workspace-pane/tab-providers.ts'

export function useWorkspacePaneVisibleStatusRefresh({
  workspaceId,
  workspaceRuntimeId,
  branchName,
  renderedTab,
  unavailable,
}: {
  workspaceId: string
  workspaceRuntimeId: string
  branchName: string | null
  renderedTab: WorkspacePaneTabType | null
  unavailable: boolean
}): void {
  const lastRequestedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const provider = renderedTab ? workspacePaneTabProvider(renderedTab) : null
    if (!provider?.refreshOnVisible || !branchName) {
      lastRequestedKeyRef.current = null
      return
    }
    const key = [workspaceId, workspaceRuntimeId, branchName, renderedTab].join('\0')
    if (key === lastRequestedKeyRef.current) return
    if (unavailable) return
    if (
      requestVisibleWorkspaceStatusRefresh(
        { get: useWorkspacesStore.getState, set: useWorkspacesStore.setState },
        workspaceId,
        workspaceRuntimeId,
        branchName,
      )
    ) {
      lastRequestedKeyRef.current = key
    }
  }, [branchName, renderedTab, workspaceId, workspaceRuntimeId, unavailable])
}
