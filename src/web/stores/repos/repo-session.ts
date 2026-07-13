import type { RestoredWorkspaceRepoRuntime, WorkspaceRuntimeRestoreSnapshot } from '#/shared/api-types.ts'
import type { RepoSessionHydrationOptions, ReposGet, ReposSet, ReposStore } from '#/web/stores/repos/types.ts'
import {
  addResolvedRepo,
  createRuntimeRepoSessionActions,
  refreshInitialRepoState,
} from '#/web/stores/repos/repo-session-write-paths.ts'
import { restoredRepoIdAfterWorkspaceHydration } from '#/web/open-workspace-state.ts'
import { updateRepoRuntimeCache } from '#/web/repo-runtime-query.ts'
import { seedRepoProjectionQueryData } from '#/web/repo-data-query.ts'
import { acceptRepoProjectionReadModel } from '#/web/stores/repos/projection-read-model-effects.ts'
import { writeWorkspacePaneTabsSnapshotQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

interface InitialRepoRefresh {
  id: string
  repoRuntimeId: string
}

type RestorableWorkspaceLifecycleActions = Pick<ReposStore, 'hydrateRestoredWorkspaceRuntime'>

function createRestorableWorkspaceLifecycleActions(set: ReposSet, get: ReposGet): RestorableWorkspaceLifecycleActions {
  return {
    async hydrateRestoredWorkspaceRuntime(runtime: WorkspaceRuntimeRestoreSnapshot, options?: RepoSessionHydrationOptions) {
      const { signal } = options ?? {}
      if (signal?.aborted) return
      const rankById = new Map<string, number>()
      runtime.repos.forEach((repo, index) => {
        if (!rankById.has(repo.repoRoot)) rankById.set(repo.repoRoot, index)
      })
      await Promise.all(
        runtime.repos.map((repo) =>
          updateRepoRuntimeCache({
            repoRoot: repo.repoRoot,
            repoRuntimeId: repo.repoRuntimeId,
            ...(repo.target ? { remoteLifecycle: { kind: 'ready' as const, attemptId: 0, target: repo.target } } : {}),
          }),
        ),
      )
      if (signal?.aborted) return
      const initialRefreshes: InitialRepoRefresh[] = []
      for (const tabs of runtime.workspacePaneTabs) {
        writeWorkspacePaneTabsSnapshotQueryData(tabs.repoRoot, tabs.repoRuntimeId, tabs.snapshot)
      }
      for (const restoredRepo of runtime.repos) {
        seedRepoProjectionQueryData(restoredRepo.repoRoot, restoredRepo.repoRuntimeId, restoredRepo.projection)
        set((s) => {
          const { repos, order } = addResolvedRepo(s, resolvedRepoFromRestoredRuntime(restoredRepo), restoredRepo.repoRuntimeId, rankById)
          const repo = repos[restoredRepo.repoRoot]
          if (repo) initialRefreshes.push({ id: repo.id, repoRuntimeId: repo.repoRuntimeId })
          const nextRestoredRepoId = restoredRepoIdAfterWorkspaceHydration(
            s.restoredRepoId,
            repos,
            order,
            runtime.restoredRepoId,
            null,
          )
          if (repos === s.repos && order === s.order && nextRestoredRepoId === s.restoredRepoId) return s
          return { repos, order, restoredRepoId: nextRestoredRepoId }
        })
        acceptRepoProjectionReadModel(
          set,
          get,
          { repoRoot: restoredRepo.repoRoot, repoRuntimeId: restoredRepo.repoRuntimeId, projection: restoredRepo.projection },
          { scope: 'repo-read-model' },
        )
      }
      if (signal?.aborted) return
      set((s) => {
        if (s.workspaceMembershipReady) return s
        return { workspaceMembershipReady: true }
      })
      for (const initialRefresh of initialRefreshes) {
        if (signal?.aborted) return
        refreshInitialRepoState(set, get, initialRefresh)
      }
    },
  }
}

export function createRepoSessionActions(set: ReposSet, get: ReposGet) {
  return {
    ...createRuntimeRepoSessionActions(set, get),
    ...createRestorableWorkspaceLifecycleActions(set, get),
  }
}

function resolvedRepoFromRestoredRuntime(restored: RestoredWorkspaceRepoRuntime) {
  return {
    id: restored.repoRoot,
    name: restored.name,
    ...(restored.target ? { target: restored.target } : {}),
  }
}
