import {
  createRepoWorkspaceTabModel,
  repoWorkspaceTabModelBlocksTabInteraction,
  type RepoWorkspaceTabModel,
} from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { readWorkspacePaneTabsProjectionForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { readWorkspacePaneRuntimeTabTargetProjection } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-projection.ts'
import { workspacePaneTabsInteractionBlockedForTarget } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import type { WorkspacePaneActionTarget } from '#/web/workspace-pane/workspace-pane-action-queue.ts'

export type WorkspacePaneTabTargetResolution =
  | { kind: 'ready'; target: RepoWorkspaceTabModel }
  | { kind: 'missing' }
  | {
      kind: 'unavailable'
      reason: 'branch-read-model-unavailable' | 'workspace-pane-tabs-pending' | 'workspace-pane-tabs-failed'
    }

export interface WorkspacePaneTabTargetOptions {
  /**
   * `undefined` means no route context is available, so use persisted
   * workspace-pane preference. `null` is an explicit bare branch route and
   * therefore has no active pane tab.
   */
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
}

export const workspacePanePreferenceTargetOptions: WorkspacePaneTabTargetOptions = { workspacePaneRoute: undefined }

export interface WorkspacePaneDestinationTargetLease extends WorkspacePaneActionTarget {
  branchName: string
  worktreePath: string | null
}

export type WorkspacePaneTargetLease = WorkspacePaneActionTarget & { branchName: string }

export type WorkspacePaneDestinationTargetResolution =
  | { kind: 'ready'; lease: WorkspacePaneDestinationTargetLease }
  | { kind: 'missing' }

export function resolveWorkspacePaneDestinationTarget(
  repoId: string,
  branchName: string,
): WorkspacePaneDestinationTargetResolution {
  const repo = useReposStore.getState().repos[repoId]
  if (!repo) return { kind: 'missing' }
  const branchModel = readRepoBranchQueryProjection(repo)
  const branch = branchModel?.branches.find((candidate) => candidate.name === branchName)
  if (!branch) return { kind: 'missing' }
  const worktreePath = branch.worktree?.path ?? null
  return {
    kind: 'ready',
    lease: {
      repoId,
      repoRuntimeId: repo.repoRuntimeId,
      branchName,
      worktreePath,
    },
  }
}

export function resolveWorkspacePaneDestinationTargetLease(
  repoId: string,
  branchName: string,
): WorkspacePaneDestinationTargetLease | null {
  const resolution = resolveWorkspacePaneDestinationTarget(repoId, branchName)
  return resolution.kind === 'ready' ? resolution.lease : null
}

export function workspacePaneTargetLeaseIsCurrent(lease: WorkspacePaneTargetLease): boolean {
  const current = resolveWorkspacePaneDestinationTargetLease(lease.repoId, lease.branchName)
  return (
    current !== null &&
    current.repoRuntimeId === lease.repoRuntimeId &&
    current.worktreePath === lease.worktreePath
  )
}

export function workspacePaneTabTargetForBranch(
  repoId: string,
  branchName: string,
  options: WorkspacePaneTabTargetOptions,
): RepoWorkspaceTabModel | null {
  const resolution = resolveWorkspacePaneTabTargetForBranch(repoId, branchName, options)
  return resolution.kind === 'ready' ? resolution.target : null
}

export function workspacePaneTabTargetForCreatedRuntime(
  repoId: string,
  canonicalBranch: string,
  worktreePath: string,
  options: WorkspacePaneTabTargetOptions,
): RepoWorkspaceTabModel | null {
  const resolution = resolveWorkspacePaneTabTarget(repoId, canonicalBranch, worktreePath, options)
  return resolution.kind === 'ready' ? resolution.target : null
}

function resolveWorkspacePaneTabTarget(
  repoId: string,
  branchName: string,
  worktreePath: string | null,
  options: WorkspacePaneTabTargetOptions,
): WorkspacePaneTabTargetResolution {
  const repo = useReposStore.getState().repos[repoId]
  if (!repo) return { kind: 'missing' }
  const runtimeProjection = readWorkspacePaneRuntimeTabTargetProjection({
    repoRoot: repoId,
    repoRuntimeId: repo.repoRuntimeId,
    worktreePath,
  })
  const tabEntriesProjection = readWorkspacePaneTabsProjectionForTarget({
    repoRoot: repoId,
    repoRuntimeId: repo.repoRuntimeId,
    branchName,
    worktreePath,
  })
  if (tabEntriesProjection.phase !== 'ready') {
    return {
      kind: 'unavailable',
      reason: tabEntriesProjection.phase === 'failed' ? 'workspace-pane-tabs-failed' : 'workspace-pane-tabs-pending',
    }
  }
  return {
    kind: 'ready',
    target: createRepoWorkspaceTabModel({
      repoId,
      repoRuntimeId: repo.repoRuntimeId,
      branchName,
      worktreePath,
      preferredTab: preferredWorkspacePaneTabForRoute(
        repo.ui,
        { repoRoot: repoId, branchName, worktreePath },
        options,
      ),
      allowPreferredTabFallback: options.workspacePaneRoute === undefined,
      tabEntries: tabEntriesProjection.tabs,
      tabEntriesProjectionPhase: tabEntriesProjection.phase,
      runtimeTabViews: runtimeProjection.runtimeTabViews,
      runtimeTabStateByType: runtimeProjection.runtimeTabStateByType,
      requestedSessionIdByRuntimeType:
        options.workspacePaneRoute?.kind === 'terminal'
          ? { terminal: options.workspacePaneRoute.terminalSessionId }
          : undefined,
    }),
  }
}

export function workspacePaneTabInteractionBlockedForBranch(
  repoId: string,
  branchName: string,
  options: WorkspacePaneTabTargetOptions,
): boolean {
  const resolution = resolveWorkspacePaneTabTargetForBranch(repoId, branchName, options)
  if (resolution.kind === 'unavailable') return true
  return resolution.kind === 'ready' ? workspacePaneTabTargetBlocksInteraction(resolution.target) : false
}

export function workspacePaneRouteNavigationBlockedForBranch(repoId: string, branchName: string): boolean {
  const state = useReposStore.getState()
  const repo = state.repos[repoId]
  if (!repo) return false
  const branchModel = readRepoBranchQueryProjection(repo)
  if (!branchModel) return false
  const branch = branchModel.branches.find((candidate) => candidate.name === branchName)
  if (!branch) return false
  if (
    workspacePaneTabsInteractionBlockedForTarget({
      repoRoot: repo.id,
      branchName,
      worktreePath: branch.worktree?.path ?? null,
    })
  )
    return true
  const runtimeProjection = readWorkspacePaneRuntimeTabTargetProjection({
    repoRoot: repo.id,
    repoRuntimeId: repo.repoRuntimeId,
    worktreePath: branch.worktree?.path ?? null,
  })
  return Object.values(runtimeProjection.runtimeTabStateByType).some((state) => state.createPending)
}

export function resolveWorkspacePaneTabTargetForBranch(
  repoId: string,
  branchName: string,
  options: WorkspacePaneTabTargetOptions,
): WorkspacePaneTabTargetResolution {
  const state = useReposStore.getState()
  const repo = state.repos[repoId]
  if (!repo) return { kind: 'missing' }
  const branchModel = readRepoBranchQueryProjection(repo)
  if (!branchModel) return { kind: 'unavailable', reason: 'branch-read-model-unavailable' }
  const branch = branchModel.branches.find((candidate) => candidate.name === branchName)
  if (!branch) return { kind: 'missing' }
  const worktreePath = branch.worktree?.path ?? null
  return resolveWorkspacePaneTabTarget(repoId, branchName, worktreePath, options)
}

function preferredWorkspacePaneTabForRoute(
  ui: Parameters<typeof preferredWorkspacePaneTabForTarget>[0],
  target: Parameters<typeof preferredWorkspacePaneTabForTarget>[1],
  options: WorkspacePaneTabTargetOptions,
) {
  const route = options.workspacePaneRoute
  if (route === undefined) return preferredWorkspacePaneTabForTarget(ui, target)
  if (route === null) return null
  if (route.kind === 'static') return route.tab
  if (route.kind === 'terminal') return 'terminal'
  return null
}

export function workspacePaneTabTargetBlocksInteraction(model: RepoWorkspaceTabModel): boolean {
  return (
    repoWorkspaceTabModelBlocksTabInteraction(model) ||
    workspacePaneTabsInteractionBlockedForTarget({
      repoRoot: model.repoId,
      branchName: model.branchName,
      worktreePath: model.worktreePath,
    })
  )
}
