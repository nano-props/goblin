// Lazy restore hook: when the user navigates to a repo that was hydrated
// as a stub at cold start (no projection, no pane tabs), this hook fires
// the per-repo `POST /api/settings/session/restore-repo-tabs` request and
// hydrates the returned repo into the store.
//
// Why per-repo: cold start used to probe + project every persisted repo.
// That's a lot of git I/O for repos the user isn't viewing. The active
// repo is fully restored at startup; non-active repos are stub leases
// until the user opens them.

import { useEffect } from 'react'
import { restoreRepoTabsOnView } from '#/web/settings-actions.ts'
import { writeWorkspacePaneTabsSnapshotQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { updateRepoRuntimeCache } from '#/web/repo-runtime-query.ts'
import { readOrCreateWebTerminalClientId } from '#/web/client-terminal-id.ts'
import { bootstrapLog } from '#/web/logger.ts'

// Module-level dedupe so concurrent mounts (e.g. user clicks a stub while
// the route is still hydrating) share a single in-flight restore.
const inFlightRestores = new Map<string, Promise<void>>()

export function useRestoreRepoTabsOnView({ hydratedRouteRepoId }: { hydratedRouteRepoId: string | null }) {
  useEffect(() => {
    if (!hydratedRouteRepoId) return
    const repo = useReposStore.getState().repos[hydratedRouteRepoId]
    if (!repo) return
    // Already restored (active repo at cold start, or already-restored stub).
    // The discriminator is `repoReadModel.loadedAt` — it is `null` for stubs
    // (no projection accepted yet) and a timestamp after a successful
    // hydrateRestoredWorkspaceRuntime run.
    if (repo.dataLoads.repoReadModel.loadedAt !== null) return

    const key = `${hydratedRouteRepoId}\0${repo.repoRuntimeId}`
    let promise = inFlightRestores.get(key)
    if (!promise) {
      promise = runLazyRestore(hydratedRouteRepoId, repo.repoRuntimeId).finally(() => {
        inFlightRestores.delete(key)
      })
      inFlightRestores.set(key, promise)
    }
    void promise
  }, [hydratedRouteRepoId])
}

async function runLazyRestore(repoRoot: string, repoRuntimeId: string): Promise<void> {
  try {
    const result = await restoreRepoTabsOnView(readOrCreateWebTerminalClientId(), repoRoot, repoRuntimeId)
    await updateRepoRuntimeCache({
      repoRoot: result.repo.repoRoot,
      repoRuntimeId: result.repo.repoRuntimeId,
      ...(result.repo.target ? { remoteLifecycle: { kind: 'ready' as const, attemptId: 0, target: result.repo.target } } : {}),
    })
    writeWorkspacePaneTabsSnapshotQueryData(
      result.repo.repoRoot,
      result.repo.repoRuntimeId,
      result.snapshot,
    )
    // Re-use the existing hydration sink. The stub entry in the store
    // (projection: null) gets overwritten with the full repo + projection;
    // acceptRepoProjectionReadModel runs through the same code path as a
    // fresh restore, and the post-hydration refresh loop fires once for
    // this single repo — exactly what we want.
    await useReposStore.getState().hydrateRestoredWorkspaceRuntime({
      repos: [result.repo],
      workspacePaneTabs: result.snapshot
        ? [{ repoRoot: result.repo.repoRoot, repoRuntimeId: result.repo.repoRuntimeId, snapshot: result.snapshot }]
        : [],
      restoredRepoId: result.repo.repoRoot,
    })
  } catch (err) {
    bootstrapLog.warn('lazy restore-repo-tabs failed', { err, repoRoot })
  }
}