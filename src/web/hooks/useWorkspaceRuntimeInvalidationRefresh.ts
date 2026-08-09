import { onScopeDispose } from 'vue'
import { goblinLog } from '#/web/logger.ts'
import { acceptRemoteWorkspaceLifecycleSnapshot } from '#/web/stores/workspaces/remote-workspace-lifecycle-projection.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { invalidateWorkspaceRuntimes } from '#/web/workspace-runtime-query.ts'
import { subscribeWorkspaceRuntimeInvalidation } from '#/web/workspace-runtime-invalidation-ingress.ts'

export function useWorkspaceRuntimeInvalidationRefresh(): void {
  let active = true

  const enqueueRefresh = () => {
    void (async () => {
      const snapshot = await invalidateWorkspaceRuntimes()
      if (!active) return
      // Probe snapshots are unversioned and may overwrite a newer command result.
      // Cross-window capability convergence stays best-effort via Refresh or reload.
      acceptRemoteWorkspaceLifecycleSnapshot(workspacesStore.setState, workspacesStore.getState, snapshot)
    })().catch((error) => goblinLog.warn('workspace runtime invalidation refresh failed', { error }))
  }

  const unsubscribe = subscribeWorkspaceRuntimeInvalidation((event) => {
    const workspace = workspacesStore.getState().workspaces[event.workspaceId]
    if (!workspace) return
    enqueueRefresh()
  })
  onScopeDispose(() => {
    active = false
    unsubscribe()
  })
}
