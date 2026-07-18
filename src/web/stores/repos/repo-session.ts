import {
  isProjectedRestoredWorkspaceRuntime,
  type WorkspaceTabsRestoreResult,
  type RestoredWorkspaceRuntime,
  type WorkspaceRuntimeRestoreSnapshot,
} from '#/shared/api-types.ts'
import type { RepoWorkspaceHydrationOptions, ReposGet, ReposSet, ReposStore } from '#/web/stores/repos/types.ts'
import {
  addResolvedRepo,
  createWorkspaceSessionActions,
  refreshInitialRepoState,
} from '#/web/stores/repos/repo-session-write-paths.ts'
import { restoredRepoIdAfterWorkspaceHydration } from '#/web/open-workspace-state.ts'
import { updateWorkspaceRuntimeCache } from '#/web/workspace-runtime-query.ts'
import { seedRepoProjectionQueryData } from '#/web/repo-data-query.ts'
import { acceptRepoProjectionReadModel } from '#/web/stores/repos/projection-read-model-effects.ts'
import { writeWorkspacePaneTabsSnapshotQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneTabsByTargetFromQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import { restoredPreferredWorkspacePaneTabByTarget } from '#/web/restorable-workspace-state.ts'
import { recordWithoutKey } from '#/shared/record.ts'
import { workspaceGitUnavailable } from '#/shared/workspace-runtime.ts'

interface InitialRepoRefresh {
  id: string
  workspaceRuntimeId: string
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
      runtime.workspaces.forEach((repo, index) => {
        if (!rankById.has(repo.workspaceId)) rankById.set(repo.workspaceId, index)
      })
      await Promise.all(
        runtime.workspaces.map((repo) =>
          updateWorkspaceRuntimeCache({
            workspaceId: repo.workspaceId,
            workspaceRuntimeId: repo.workspaceRuntimeId,
            ...(repo.target ? { remoteLifecycle: { kind: 'ready' as const, attemptId: 0, target: repo.target } } : {}),
          }),
        ),
      )
      if (signal?.aborted) return
      const initialRefreshes: InitialRepoRefresh[] = []
      for (const tabs of runtime.workspacePaneTabs) {
        writeWorkspacePaneTabsSnapshotQueryData(tabs.workspaceId, tabs.workspaceRuntimeId, tabs.snapshot)
      }
      for (const restoredRepo of runtime.workspaces) {
        seedRepoProjectionQueryData(restoredRepo.workspaceId, restoredRepo.workspaceRuntimeId, restoredRepo.projection)
        set((s) => {
          const { repos, order } = addResolvedRepo(
            s,
            resolvedRepoFromRestoredRuntime(restoredRepo),
            restoredRepo.workspaceRuntimeId,
            rankById,
          )
          const repo = repos[restoredRepo.workspaceId]
          // Stub leases (projection: null) skip the post-hydration projection
          // refresh — that's the entire point of the active-only restore. The
          // lazy `useRestoreRepoTabsOnView` hook fires the first refresh when
          // the user navigates to a stub repo.
          if (repo && isProjectedRestoredWorkspaceRuntime(restoredRepo)) {
            initialRefreshes.push({ id: repo.id, workspaceRuntimeId: repo.workspaceRuntimeId })
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
            repoRoot: restoredRepo.workspaceId,
            workspaceRuntimeId: restoredRepo.workspaceRuntimeId,
            projection: restoredRepo.projection,
          },
          { scope: 'repo-read-model' },
        )
        if (isProjectedRestoredWorkspaceRuntime(restoredRepo) || workspaceGitUnavailable(restoredRepo.workspaceProbe)) {
          applyRestoredPreferredWorkspacePaneTabs(
            set,
            get,
            restoredRepo.workspaceId,
            tabsSnapshotForRepo(runtime, restoredRepo.workspaceId),
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

    promoteRestoredWorkspaceRepo(result: WorkspaceTabsRestoreResult): boolean {
      const restoredRepo = result.workspace
      let promoted = false
      set((s) => {
        const current = s.repos[restoredRepo.workspaceId]
        if (
          !current ||
          current.workspaceRuntimeId !== restoredRepo.workspaceRuntimeId ||
          current.session.projectionState !== 'stub'
        ) {
          return s
        }
        const { repos } = addResolvedRepo(
          s,
          resolvedRepoForProjectionPromotion(restoredRepo),
          restoredRepo.workspaceRuntimeId,
        )
        promoted = true
        return repos === s.repos ? s : { repos }
      })
      if (!promoted) return false

      if (!isProjectedRestoredWorkspaceRuntime(restoredRepo)) {
        writeWorkspacePaneTabsSnapshotQueryData(restoredRepo.workspaceId, restoredRepo.workspaceRuntimeId, result.snapshot)
        return true
      }
      seedRepoProjectionQueryData(restoredRepo.workspaceId, restoredRepo.workspaceRuntimeId, restoredRepo.projection)
      writeWorkspacePaneTabsSnapshotQueryData(restoredRepo.workspaceId, restoredRepo.workspaceRuntimeId, result.snapshot)
      acceptRepoProjectionReadModel(
        set,
        get,
        {
          repoRoot: restoredRepo.workspaceId,
          workspaceRuntimeId: restoredRepo.workspaceRuntimeId,
          projection: restoredRepo.projection,
        },
        { scope: 'repo-read-model' },
      )
      applyRestoredPreferredWorkspacePaneTabs(set, get, restoredRepo.workspaceId, result.snapshot)
      return true
    },
  }
}

function tabsSnapshotForRepo(runtime: WorkspaceRuntimeRestoreSnapshot, repoRoot: string) {
  return runtime.workspacePaneTabs.find((entry) => entry.workspaceId === repoRoot)?.snapshot ?? null
}

function applyRestoredPreferredWorkspacePaneTabs(
  set: ReposSet,
  get: ReposGet,
  repoRoot: string,
  snapshot: WorkspaceTabsRestoreResult['snapshot'],
): void {
  const state = get()
  const repo = state.repos[repoRoot]
  const restoredPreferred = state.restoredClientWorkspaceBaseline?.preferredWorkspacePaneTabByTargetByRepo[repoRoot]
  if (!repo || !restoredPreferred) return
  const branchProjection = readRepoBranchSnapshotQueryProjection(repo)?.branches
  const branches = branchProjection ?? (workspaceGitUnavailable(repo.workspaceProbe) ? [] : null)
  if (!branches) return
  const preferredWorkspacePaneTabByTarget = restoredPreferredWorkspacePaneTabByTarget(
    repoRoot,
    { branches },
    restoredPreferred,
    snapshot ? workspacePaneTabsByTargetFromQueryData(snapshot) : {},
  )
  set((current) => {
    const currentRepo = current.repos[repoRoot]
    if (!currentRepo || currentRepo.workspaceRuntimeId !== repo.workspaceRuntimeId) return current
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
    ...createWorkspaceSessionActions(set, get),
    ...createRestorableWorkspaceLifecycleActions(set, get),
  }
}

function resolvedRepoFromRestoredRuntime(restored: RestoredWorkspaceRuntime) {
  const workspaceSettledWithoutGit =
    restored.workspaceProbe.status === 'unavailable' ||
    (restored.workspaceProbe.status === 'ready' && restored.workspaceProbe.capabilities.git.status === 'unavailable')
  return {
    id: restored.workspaceId,
    name: restored.name,
    workspaceProbe: restored.workspaceProbe,
    ...(restored.target ? { target: restored.target } : {}),
    session: {
      entry: restored.entry,
      projectionState:
        isProjectedRestoredWorkspaceRuntime(restored) || workspaceSettledWithoutGit
          ? ('projected' as const)
          : ('stub' as const),
    },
  }
}

function resolvedRepoForProjectionPromotion(restored: RestoredWorkspaceRuntime) {
  const resolvedRepo = resolvedRepoFromRestoredRuntime(restored)
  return {
    id: resolvedRepo.id,
    name: resolvedRepo.name,
    workspaceProbe: resolvedRepo.workspaceProbe,
    session: resolvedRepo.session,
  }
}
