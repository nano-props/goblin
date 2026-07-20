import {
  hasRestoredWorkspaceGitProjection,
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
import { acceptRemoteWorkspaceRuntimeProjection } from '#/web/stores/workspaces/remote-workspace-lifecycle-projection.ts'

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
        runtime.workspaces.map((workspace) => {
          const remoteLifecycle = workspace.transport.kind === 'ssh' ? workspace.transport.lifecycle : null
          return updateWorkspaceRuntimeCache({
            workspaceId: workspace.workspaceId,
            workspaceRuntimeId: workspace.workspaceRuntimeId,
            ...(remoteLifecycle ? { remoteLifecycle } : {}),
          })
        }),
      )
      if (signal?.aborted) return
      const initialRefreshes: InitialWorkspaceRefresh[] = []
      for (const tabs of runtime.workspacePaneTabs) {
        writeWorkspacePaneTabsSnapshotQueryData(tabs.workspaceId, tabs.workspaceRuntimeId, tabs.snapshot)
      }
      for (const restoredWorkspace of runtime.workspaces) {
        const remoteLifecycle =
          restoredWorkspace.transport.kind === 'ssh' ? restoredWorkspace.transport.lifecycle : null
        const hasCurrentRemoteRuntime =
          remoteLifecycle !== null &&
          get().workspaces[restoredWorkspace.workspaceId]?.workspaceRuntimeId === restoredWorkspace.workspaceRuntimeId
        if (
          hasCurrentRemoteRuntime &&
          !acceptRemoteWorkspaceRuntimeProjection(set, get, {
            workspaceId: restoredWorkspace.workspaceId,
            workspaceRuntimeId: restoredWorkspace.workspaceRuntimeId,
            remoteLifecycle,
            workspaceProbe: restoredWorkspace.workspaceProbe,
          })
        ) {
          continue
        }
        set((s) => {
          const { workspaces, workspaceOrder } = addResolvedWorkspace(
            s,
            resolvedWorkspaceFromRestoredRuntime(restoredWorkspace),
            restoredWorkspace.workspaceRuntimeId,
            rankById,
          )
          const workspace = workspaces[restoredWorkspace.workspaceId]
          // Only server-projected Git data starts an immediate read-model refresh.
          // Deferred Git projections are loaded on view; filesystem-only workspaces
          // remain complete without a Git projection.
          if (workspace && hasRestoredWorkspaceGitProjection(restoredWorkspace)) {
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
        if (
          remoteLifecycle !== null &&
          !hasCurrentRemoteRuntime &&
          !acceptRemoteWorkspaceRuntimeProjection(set, get, {
            workspaceId: restoredWorkspace.workspaceId,
            workspaceRuntimeId: restoredWorkspace.workspaceRuntimeId,
            remoteLifecycle,
            workspaceProbe: restoredWorkspace.workspaceProbe,
          })
        ) {
          continue
        }
        seedRepoProjectionQueryData(
          restoredWorkspace.workspaceId,
          restoredWorkspace.workspaceRuntimeId,
          restoredWorkspace.gitProjection,
        )
        acceptRepoProjectionReadModel(
          set,
          get,
          {
            repoRoot: restoredWorkspace.workspaceId,
            workspaceRuntimeId: restoredWorkspace.workspaceRuntimeId,
            projection: restoredWorkspace.gitProjection,
          },
          { scope: 'repo-read-model' },
        )
        if (
          hasRestoredWorkspaceGitProjection(restoredWorkspace) ||
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
      const current = get().workspaces[restoredWorkspace.workspaceId]
      if (
        !current ||
        current.workspaceRuntimeId !== restoredWorkspace.workspaceRuntimeId ||
        current.session.projectionState !== 'stub'
      ) {
        return false
      }
      const remoteLifecycle = restoredWorkspace.transport.kind === 'ssh' ? restoredWorkspace.transport.lifecycle : null
      if (
        remoteLifecycle &&
        !acceptRemoteWorkspaceRuntimeProjection(set, get, {
          workspaceId: restoredWorkspace.workspaceId,
          workspaceRuntimeId: restoredWorkspace.workspaceRuntimeId,
          remoteLifecycle,
          workspaceProbe: restoredWorkspace.workspaceProbe,
        })
      ) {
        return false
      }
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
          resolvedWorkspaceFromRestoredRuntime(restoredWorkspace),
          restoredWorkspace.workspaceRuntimeId,
        )
        promoted = true
        return workspaces === s.workspaces ? s : { workspaces }
      })
      if (!promoted) return false

      if (!hasRestoredWorkspaceGitProjection(restoredWorkspace)) {
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
        restoredWorkspace.gitProjection,
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
          projection: restoredWorkspace.gitProjection,
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
  const session = {
    entry: restored.entry,
    projectionState:
      hasRestoredWorkspaceGitProjection(restored) || workspaceSettledWithoutGit
        ? ('projected' as const)
        : ('stub' as const),
  }
  if (restored.transport.kind === 'ssh') {
    return { id: restored.workspaceId, name: restored.name, session }
  }
  return {
    id: restored.workspaceId,
    name: restored.name,
    workspaceProbe: restored.workspaceProbe,
    session,
  }
}
