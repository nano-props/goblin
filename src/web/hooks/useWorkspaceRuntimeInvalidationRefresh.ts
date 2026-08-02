import { useEffect } from 'react'
import { goblinLog } from '#/web/logger.ts'
import { acceptRemoteWorkspaceLifecycleSnapshot } from '#/web/stores/workspaces/remote-workspace-lifecycle-projection.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { invalidateWorkspaceRuntimes } from '#/web/workspace-runtime-query.ts'
import { subscribeWorkspaceRuntimeInvalidation } from '#/web/workspace-runtime-invalidation-ingress.ts'

export function useWorkspaceRuntimeInvalidationRefresh(): void {
  useEffect(() => {
    let active = true

    const enqueueRefresh = () => {
      void (async () => {
        const snapshot = await invalidateWorkspaceRuntimes()
        if (!active) return
        // Probe snapshots are unversioned and may overwrite a newer command result.
        // Cross-window capability convergence stays best-effort via Refresh or reload.
        acceptRemoteWorkspaceLifecycleSnapshot(useWorkspacesStore.setState, useWorkspacesStore.getState, snapshot)
      })().catch((error) => goblinLog.warn('workspace runtime invalidation refresh failed', { error }))
    }

    const unsubscribe = subscribeWorkspaceRuntimeInvalidation((event) => {
      const workspace = useWorkspacesStore.getState().workspaces[event.workspaceId]
      if (!workspace) return
      enqueueRefresh()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
}
