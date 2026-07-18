import { useEffect, useRef } from 'react'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { requestVisibleWorkspaceStatusRefresh } from '#/web/stores/repos/repo-refresh-actions.ts'
import { workspacePaneTabProvider } from '#/web/workspace-pane/tab-providers.ts'

export function useWorkspacePaneVisibleStatusRefresh({
  repoId,
  workspaceRuntimeId,
  branchName,
  renderedTab,
  unavailable,
}: {
  repoId: string
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
    const key = [repoId, workspaceRuntimeId, branchName, renderedTab].join('\0')
    if (key === lastRequestedKeyRef.current) return
    if (unavailable) return
    if (
      requestVisibleWorkspaceStatusRefresh(
        { get: useReposStore.getState, set: useReposStore.setState },
        repoId,
        workspaceRuntimeId,
        branchName,
      )
    ) {
      lastRequestedKeyRef.current = key
    }
  }, [branchName, renderedTab, repoId, workspaceRuntimeId, unavailable])
}
