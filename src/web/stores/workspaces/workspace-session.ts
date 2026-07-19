import {
  isProjectedRestoredWorkspaceRuntime,
  type WorkspaceTabsRestoreResult,
  type RestoredWorkspaceRuntime,
  type WorkspaceRuntimeRestoreSnapshot,
} from '#/shared/api-types.ts'
import type {
  WorkspaceHydrationOptions,
  WorkspacesGet,
  WorkspacesSet,
  WorkspacesStore,
} from '#/web/stores/workspaces/types.ts'
import {
  addResolvedWorkspace,
  createWorkspaceLifecycleActions,
  refreshInitialWorkspaceState,
} from '#/web/stores/workspaces/workspace-session-write-paths.ts'
import { restoredWorkspaceIdAfterWorkspaceHydration } from '#/web/open-workspace-state.ts'
import { updateWorkspaceRuntimeCache } from '#/web/workspace-runtime-query.ts'
import { seedRepoProjectionQueryData } from '#/web/repo-data-query.ts'
import { acceptRepoProjectionReadModel } from '#/web/stores/workspaces/projection-read-model-effects.ts'
import { writeWorkspacePaneTabsSnapshotQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneTabsByTargetFromQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import { restoredPreferredWorkspacePaneTabByTarget } from '#/web/restorable-workspace-state.ts'
import { recordWithoutKey } from '#/shared/record.ts'
import { workspaceGitUnavailable } from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

interface InitialWorkspaceRefresh {
  id: WorkspaceId
  workspaceRuntimeId: string
}

type RestorableWorkspaceLifecycleActions = Pick<
  WorkspacesStore,
  'hydrateRestoredWorkspaceRuntime' | 'promoteRestoredWorkspace'
>

function createRestorableWorkspaceLifecycleActions(
  set: WorkspacesSet,
  get: WorkspacesGet,
): RestorableWorkspaceLifecycleActions {
  return {
    async hydrateRestoredWorkspaceRuntime(
      runtime: WorkspaceRuntimeRestoreSnapshot,
      options?: WorkspaceHydrationOptions,
    ) {
      const { signal } = options ?? {}
      if (signal?.aborted) return
      if (options && 'restoredClientWorkspace' in options) {
        set({ restoredClientWorkspaceBaseline: options.restoredClientWorkspace ?? null })
      }
      const rankById = new Map<string, number>()
      runtime.workspaces.forEach((workspace, index) => {
        if (!rankById.has(workspace.workspaceId)) rankById.set(workspace.workspaceId, index)
      })
      await Promise.all(
        runtime.workspaces.map((workspace) =>
          updateWorkspaceRuntimeCache({
            workspaceId: workspace.workspaceId,
            workspaceRuntimeId: workspace.workspaceRuntimeId,
            ...(workspace.target
              ? { remoteLifecycle: { kind: 'ready' as const, attemptId: 0, target: workspace.target } }
              : {}),
          }),
        ),
      )
      if (signal?.aborted) return
      const initialRefreshes: InitialWorkspaceRefresh[] = []
      for (const tabs of runtime.workspacePaneTabs) {
        writeWorkspacePaneTabsSnapshotQueryData(tabs.workspaceId, tabs.workspaceRuntimeId, tabs.snapshot)
      }
      for (const restoredWorkspace of runtime.workspaces) {
        seedRepoProjectionQueryData(
          restoredWorkspace.workspaceId,
          restoredWorkspace.workspaceRuntimeId,
          restoredWorkspace.projection,
        )
        set((s) => {
          const { workspaces, workspaceOrder } = addResolvedWorkspace(
            s,
            resolvedWorkspaceFromRestoredRuntime(restoredWorkspace),
            restoredWorkspace.workspaceRuntimeId,
            rankById,
          )
          const workspace = workspaces[restoredWorkspace.workspaceId]
          // Stub leases (projection: null) skip the post-hydration projection
          // refresh — that's the entire point of the active-only restore. The
          // lazy `useRestoreWorkspaceTabsOnView` hook fires the first refresh when
          // the user navigates to a stub workspace.
          if (workspace && isProjectedRestoredWorkspaceRuntime(restoredWorkspace)) {
            initialRefreshes.push({ id: workspace.id, workspaceRuntimeId: workspace.workspaceRuntimeId })
          }
          const nextRestoredWorkspaceId = restoredWorkspaceIdAfterWorkspaceHydration(
            s.restoredWorkspaceId,
            workspaces,
            workspaceOrder,
            runtime.restoredWorkspaceId,
            null,
          )
          if (
            workspaces === s.workspaces &&
            workspaceOrder === s.workspaceOrder &&
            nextRestoredWorkspaceId === s.restoredWorkspaceId
          )
            return s
          return { workspaces, workspaceOrder, restoredWorkspaceId: nextRestoredWorkspaceId }
        })
        acceptRepoProjectionReadModel(
          set,
          get,
          {
            repoRoot: restoredWorkspace.workspaceId,
            workspaceRuntimeId: restoredWorkspace.workspaceRuntimeId,
            projection: restoredWorkspace.projection,
          },
          { scope: 'repo-read-model' },
        )
        if (
          isProjectedRestoredWorkspaceRuntime(restoredWorkspace) ||
          workspaceGitUnavailable(restoredWorkspace.workspaceProbe)
        ) {
          applyRestoredPreferredWorkspacePaneTabs(
            set,
            get,
            restoredWorkspace.workspaceId,
            tabsSnapshotForWorkspace(runtime, restoredWorkspace.workspaceId),
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
        refreshInitialWorkspaceState(set, get, initialRefresh)
      }
    },

    promoteRestoredWorkspace(result: WorkspaceTabsRestoreResult): boolean {
      const restoredWorkspace = result.workspace
      let promoted = false
      set((s) => {
        const current = s.workspaces[restoredWorkspace.workspaceId]
        if (
          !current ||
          current.workspaceRuntimeId !== restoredWorkspace.workspaceRuntimeId ||
          current.session.projectionState !== 'stub'
        ) {
          return s
        }
        const { workspaces } = addResolvedWorkspace(
          s,
          resolvedWorkspaceForProjectionPromotion(restoredWorkspace),
          restoredWorkspace.workspaceRuntimeId,
        )
        promoted = true
        return workspaces === s.workspaces ? s : { workspaces }
      })
      if (!promoted) return false

      if (!isProjectedRestoredWorkspaceRuntime(restoredWorkspace)) {
        writeWorkspacePaneTabsSnapshotQueryData(
          restoredWorkspace.workspaceId,
          restoredWorkspace.workspaceRuntimeId,
          result.snapshot,
        )
        return true
      }
      seedRepoProjectionQueryData(
        restoredWorkspace.workspaceId,
        restoredWorkspace.workspaceRuntimeId,
        restoredWorkspace.projection,
      )
      writeWorkspacePaneTabsSnapshotQueryData(
        restoredWorkspace.workspaceId,
        restoredWorkspace.workspaceRuntimeId,
        result.snapshot,
      )
      acceptRepoProjectionReadModel(
        set,
        get,
        {
          repoRoot: restoredWorkspace.workspaceId,
          workspaceRuntimeId: restoredWorkspace.workspaceRuntimeId,
          projection: restoredWorkspace.projection,
        },
        { scope: 'repo-read-model' },
      )
      applyRestoredPreferredWorkspacePaneTabs(set, get, restoredWorkspace.workspaceId, result.snapshot)
      return true
    },
  }
}

function tabsSnapshotForWorkspace(runtime: WorkspaceRuntimeRestoreSnapshot, workspaceId: WorkspaceId) {
  return runtime.workspacePaneTabs.find((entry) => entry.workspaceId === workspaceId)?.snapshot ?? null
}

function applyRestoredPreferredWorkspacePaneTabs(
  set: WorkspacesSet,
  get: WorkspacesGet,
  workspaceId: WorkspaceId,
  snapshot: WorkspaceTabsRestoreResult['snapshot'],
): void {
  const state = get()
  const workspace = state.workspaces[workspaceId]
  const restoredPreferred =
    state.restoredClientWorkspaceBaseline?.preferredWorkspacePaneTabByTargetByWorkspace[workspaceId]
  if (!workspace || !restoredPreferred) return
  const branchProjection = readRepoBranchSnapshotQueryProjection(workspace)?.branches
  if (!branchProjection && workspace.capability.kind !== 'filesystem') return
  const preferredWorkspacePaneTabByTarget = restoredPreferredWorkspacePaneTabByTarget(
    workspace.id,
    branchProjection ? { gitTargets: { branches: branchProjection } } : {},
    restoredPreferred,
    snapshot ? workspacePaneTabsByTargetFromQueryData(snapshot) : {},
  )
  set((current) => {
    const currentWorkspace = current.workspaces[workspaceId]
    if (!currentWorkspace || currentWorkspace.workspaceRuntimeId !== workspace.workspaceRuntimeId) return current
    const baseline = current.restoredClientWorkspaceBaseline
    return {
      workspaces: {
        ...current.workspaces,
        [workspaceId]: {
          ...currentWorkspace,
          ui: {
            ...currentWorkspace.ui,
            preferredWorkspacePaneTabByTarget: {
              ...preferredWorkspacePaneTabByTarget,
              ...currentWorkspace.ui.preferredWorkspacePaneTabByTarget,
            },
          },
        },
      },
      restoredClientWorkspaceBaseline: baseline
        ? {
            ...baseline,
            preferredWorkspacePaneTabByTargetByWorkspace: recordWithoutKey(
              baseline.preferredWorkspacePaneTabByTargetByWorkspace,
              workspaceId,
            ),
          }
        : null,
    }
  })
}

export function createWorkspaceSessionActions(set: WorkspacesSet, get: WorkspacesGet) {
  return {
    ...createWorkspaceLifecycleActions(set, get),
    ...createRestorableWorkspaceLifecycleActions(set, get),
  }
}

function resolvedWorkspaceFromRestoredRuntime(restored: RestoredWorkspaceRuntime) {
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

function resolvedWorkspaceForProjectionPromotion(restored: RestoredWorkspaceRuntime) {
  const resolvedWorkspace = resolvedWorkspaceFromRestoredRuntime(restored)
  return {
    id: resolvedWorkspace.id,
    name: resolvedWorkspace.name,
    workspaceProbe: resolvedWorkspace.workspaceProbe,
    session: resolvedWorkspace.session,
  }
}
