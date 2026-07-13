import { useEffect, useRef } from 'react'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { requestVisibleWorkspaceStatusRefresh } from '#/web/stores/repos/repo-refresh-actions.ts'
import { workspacePaneTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'

export function useWorkspacePaneVisibleStatusRefresh({
  repoId,
  repoRuntimeId,
  branchName,
  renderedTab,
  visibleStatusPhase,
  unavailable,
}: {
  repoId: string
  repoRuntimeId: string
  branchName: string | null
  renderedTab: WorkspacePaneTabType | null
  visibleStatusPhase: RepoState['dataLoads']['visibleStatus']['phase']
  unavailable: boolean
}): void {
  const lastRequestedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const provider = renderedTab ? workspacePaneTabProvider(renderedTab) : null
    if (!provider?.refreshOnVisible || !branchName) {
      lastRequestedKeyRef.current = null
      return
    }
    const key = [repoId, repoRuntimeId, branchName, renderedTab].join('\0')
    if (key === lastRequestedKeyRef.current) return
    if (unavailable || visibleStatusPhase !== 'idle') return
    if (
      requestVisibleWorkspaceStatusRefresh(
        { get: useReposStore.getState, set: useReposStore.setState },
        repoId,
        repoRuntimeId,
        branchName,
      )
    ) {
      lastRequestedKeyRef.current = key
    }
  }, [branchName, renderedTab, repoId, repoRuntimeId, unavailable, visibleStatusPhase])
}
