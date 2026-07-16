import {
  isProjectedRestoredWorkspaceRepo,
  type RepoWorkspaceTabsRestoreResult,
  type RestoredWorkspaceRepoRuntime,
  type WorkspaceRuntimeRestoreSnapshot,
} from '#/shared/api-types.ts'
import type { RepoWorkspaceHydrationOptions, ReposGet, ReposSet, ReposStore } from '#/web/stores/repos/types.ts'
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
import { workspacePaneTabsByTargetFromQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import { restoredPreferredWorkspacePaneTabByTarget } from '#/web/restorable-workspace-state.ts'
import { recordWithoutKey } from '#/shared/record.ts'

interface InitialRepoRefresh {
  id: string
  repoRuntimeId: string
}

type RestorableWorkspaceLifecycleActions = Pick<
  ReposStore,
  'hydrateRestoredWorkspaceRuntime' | 'promoteRestoredWorkspaceRepo'
>

function createRestorableWorkspaceLifecycleActions(set: ReposSet, get: ReposGet): RestorableWorkspaceLifecycleActions {
  return {
    async hydrateRestoredWorkspaceRuntime(
      runtime: WorkspaceRuntimeRestoreSnapshot,
      options?: RepoWorkspaceHydrationOptions,
    ) {
      const { signal } = options ?? {}
      if (signal?.aborted) return
      if (options && 'restoredClientWorkspace' in options) {
        set({ restoredClientWorkspaceBaseline: options.restoredClientWorkspace ?? null })
      }
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
          const { repos, order } = addResolvedRepo(
            s,
            resolvedRepoFromRestoredRuntime(restoredRepo),
            restoredRepo.repoRuntimeId,
            rankById,
          )
          const repo = repos[restoredRepo.repoRoot]
          // Stub leases (projection: null) skip the post-hydration projection
          // refresh — that's the entire point of the active-only restore. The
          // lazy `useRestoreRepoTabsOnView` hook fires the first refresh when
          // the user navigates to a stub repo.
          if (repo && isProjectedRestoredWorkspaceRepo(restoredRepo)) {
            initialRefreshes.push({ id: repo.id, repoRuntimeId: repo.repoRuntimeId })
          }
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
          {
            repoRoot: restoredRepo.repoRoot,
            repoRuntimeId: restoredRepo.repoRuntimeId,
            projection: restoredRepo.projection,
          },
          { scope: 'repo-read-model' },
        )
        if (isProjectedRestoredWorkspaceRepo(restoredRepo)) {
          applyRestoredPreferredWorkspacePaneTabs(
            set,
            get,
            restoredRepo.repoRoot,
            tabsSnapshotForRepo(runtime, restoredRepo.repoRoot),
          )
        }
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

    promoteRestoredWorkspaceRepo(result: RepoWorkspaceTabsRestoreResult): boolean {
      const restoredRepo = result.repo
      let promoted = false
      set((s) => {
        const current = s.repos[restoredRepo.repoRoot]
        if (
          !current ||
          current.repoRuntimeId !== restoredRepo.repoRuntimeId ||
          current.session.projectionState !== 'stub'
        ) {
          return s
        }
        const { repos } = addResolvedRepo(s, resolvedRepoForStubPromotion(restoredRepo), restoredRepo.repoRuntimeId)
        promoted = true
        return repos === s.repos ? s : { repos }
      })
      if (!promoted) return false

      seedRepoProjectionQueryData(restoredRepo.repoRoot, restoredRepo.repoRuntimeId, restoredRepo.projection)
      writeWorkspacePaneTabsSnapshotQueryData(restoredRepo.repoRoot, restoredRepo.repoRuntimeId, result.snapshot)
      acceptRepoProjectionReadModel(
        set,
        get,
        {
          repoRoot: restoredRepo.repoRoot,
          repoRuntimeId: restoredRepo.repoRuntimeId,
          projection: restoredRepo.projection,
        },
        { scope: 'repo-read-model' },
      )
      applyRestoredPreferredWorkspacePaneTabs(set, get, restoredRepo.repoRoot, result.snapshot)
      return true
    },
  }
}

function tabsSnapshotForRepo(runtime: WorkspaceRuntimeRestoreSnapshot, repoRoot: string) {
  return runtime.workspacePaneTabs.find((entry) => entry.repoRoot === repoRoot)?.snapshot ?? null
}

function applyRestoredPreferredWorkspacePaneTabs(
  set: ReposSet,
  get: ReposGet,
  repoRoot: string,
  snapshot: RepoWorkspaceTabsRestoreResult['snapshot'],
): void {
  const state = get()
  const repo = state.repos[repoRoot]
  const branches = repo ? readRepoBranchSnapshotQueryProjection(repo)?.branches : null
  const restoredPreferred = state.restoredClientWorkspaceBaseline?.preferredWorkspacePaneTabByTargetByRepo[repoRoot]
  if (!repo || !branches || !restoredPreferred) return
  const preferredWorkspacePaneTabByTarget = restoredPreferredWorkspacePaneTabByTarget(
    repoRoot,
    { branches },
    restoredPreferred,
    snapshot ? workspacePaneTabsByTargetFromQueryData(snapshot) : {},
  )
  set((current) => {
    const currentRepo = current.repos[repoRoot]
    if (!currentRepo || currentRepo.repoRuntimeId !== repo.repoRuntimeId) return current
    const baseline = current.restoredClientWorkspaceBaseline
    return {
      repos: {
        ...current.repos,
        [repoRoot]: {
          ...currentRepo,
          ui: {
            ...currentRepo.ui,
            preferredWorkspacePaneTabByTarget: {
              ...preferredWorkspacePaneTabByTarget,
              ...currentRepo.ui.preferredWorkspacePaneTabByTarget,
            },
          },
        },
      },
      restoredClientWorkspaceBaseline: baseline
        ? {
            ...baseline,
            preferredWorkspacePaneTabByTargetByRepo: recordWithoutKey(
              baseline.preferredWorkspacePaneTabByTargetByRepo,
              repoRoot,
            ),
          }
        : null,
    }
  })
}

export function createRepoSessionActions(set: ReposSet, get: ReposGet) {
  return {
    ...createRuntimeRepoSessionActions(set, get),
    ...createRestorableWorkspaceLifecycleActions(set, get),
  }
}

function resolvedRepoFromRestoredRuntime(restored: RestoredWorkspaceRepoRuntime) {
  const workspaceSettledWithoutGit =
    restored.workspaceProbe.status === 'unavailable' ||
    (restored.workspaceProbe.status === 'ready' && restored.workspaceProbe.capabilities.git.status === 'unavailable')
  return {
    id: restored.repoRoot,
    name: restored.name,
    workspaceProbe: restored.workspaceProbe,
    ...(restored.target ? { target: restored.target } : {}),
    session: {
      entry: restored.entry,
      projectionState:
        isProjectedRestoredWorkspaceRepo(restored) || workspaceSettledWithoutGit
          ? ('projected' as const)
          : ('stub' as const),
    },
  }
}

function resolvedRepoForStubPromotion(restored: RepoWorkspaceTabsRestoreResult['repo']) {
  return {
    id: restored.repoRoot,
    name: restored.name,
    workspaceProbe: restored.workspaceProbe,
    session: {
      entry: restored.entry,
      projectionState: 'projected' as const,
    },
  }
}
