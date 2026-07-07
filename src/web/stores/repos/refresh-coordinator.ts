import type { RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import {
  shouldSuppressRepoInvalidationSource,
  resetRepoInvalidationSourceState,
} from '#/web/stores/repos/invalidation-sources.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import type { RepoState, ReposGet } from '#/web/stores/repos/types.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import { invalidateRepoDataQueries } from '#/web/repo-data-query.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'

interface RepoRefreshIntentBase {
  id: string
  repoInstanceId: string
}

type CoreRepoRefreshReason = 'initial-load' | 'branch-action'

export type RepoRefreshIntent =
  | (RepoRefreshIntentBase & { kind: 'core-data-changed'; reason: CoreRepoRefreshReason })
  | (RepoRefreshIntentBase & { kind: 'manual-refresh-requested' })
  | (RepoRefreshIntentBase & {
      kind: 'visible-runtime-projection-requested'
      reason: 'status-like-view-opened'
    })

type RepoInvalidationRefreshDisposition = 'refresh' | 'suppress'

export interface RepoStatusRefreshSnapshot {
  id: string
  repoInstanceId: string
  preferredWorkspacePaneTab: WorkspacePaneTabType
  statusViewOpen: boolean
  unavailable: boolean
  visibleStatusPhase: 'idle' | 'loading' | 'refreshing'
}

export function repoStatusRefreshSnapshot(repo: RepoState): RepoStatusRefreshSnapshot {
  return {
    id: repo.id,
    repoInstanceId: repo.instanceId,
    preferredWorkspacePaneTab: preferredWorkspacePaneTabForTarget(repo.ui, null),
    statusViewOpen: false,
    unavailable: isRepoUnavailable(repo),
    visibleStatusPhase: repo.dataLoads.visibleStatus.phase,
  }
}

export function currentRepoStatusRefreshSnapshot(
  repo: RepoState,
  branchName: string | null,
): RepoStatusRefreshSnapshot {
  const branchModel = readRepoBranchQueryProjection(repo)
  const target =
    branchModel && branchName
      ? workspacePaneTabsTargetForRepoBranch({ repoRoot: repo.id, branches: branchModel.branches }, branchName)
      : null
  const preferredWorkspacePaneTab = preferredWorkspacePaneTabForTarget(repo.ui, target)
  return {
    id: repo.id,
    repoInstanceId: repo.instanceId,
    preferredWorkspacePaneTab,
    statusViewOpen: preferredWorkspacePaneTab === 'status' || preferredWorkspacePaneTab === 'changes',
    unavailable: isRepoUnavailable(repo),
    visibleStatusPhase: repo.dataLoads.visibleStatus.phase,
  }
}

export function isRepoStatusRefreshable(repo: RepoStatusRefreshSnapshot): boolean {
  return !repo.unavailable && repo.visibleStatusPhase === 'idle'
}

async function runVisibleRuntimeProjectionRefresh(
  get: ReposGet,
  id: string,
  repoInstanceId: string,
): Promise<void> {
  const state = get()
  const repo = state.repos[id]
  if (!repo || repo.instanceId !== repoInstanceId) return
  if (!isRepoStatusRefreshable(repoStatusRefreshSnapshot(repo))) return
  await state.refreshRuntimeProjection(id, { repoInstanceId, scope: 'visible-status' })
}

export function requestVisibleRepoStatusRefresh(get: ReposGet, id: string): void {
  const repo = get().repos[id]
  if (!repo) return
  void runRepoRefreshIntent(get, {
    kind: 'visible-runtime-projection-requested',
    reason: 'status-like-view-opened',
    id,
    repoInstanceId: repo.instanceId,
  })
}

export function repoInvalidationRefreshDisposition(
  event: Pick<RepoQueryInvalidationEvent, 'sourceToken'>,
): RepoInvalidationRefreshDisposition {
  if (shouldSuppressRepoInvalidationSource(event.sourceToken)) return 'suppress'
  return 'refresh'
}

export async function handleRepoInvalidationRefresh(
  get: ReposGet,
  event: Pick<RepoQueryInvalidationEvent, 'repoId' | 'query' | 'sourceToken'>,
  repoInstanceId: string,
): Promise<void> {
  const repoId = event.repoId
  const repo = get().repos[repoId]
  if (!repo || repo.instanceId !== repoInstanceId || isRepoUnavailable(repo)) return
  const disposition = repoInvalidationRefreshDisposition(event)
  if (disposition !== 'refresh') return
  invalidateRepoDataQueries(repoId, repoInstanceId)
  await get().refreshCoreData(repoId, { repoInstanceId })
}

export function resetRepoRefreshCoordinatorState(): void {
  resetRepoInvalidationSourceState()
}

export async function runRepoRefreshIntent(get: ReposGet, intent: RepoRefreshIntent): Promise<void> {
  switch (intent.kind) {
    case 'manual-refresh-requested':
      await get().syncAndRefresh(intent.id, { repoInstanceId: intent.repoInstanceId })
      return
    case 'core-data-changed':
      await get().refreshCoreData(intent.id, { repoInstanceId: intent.repoInstanceId })
      return
    case 'visible-runtime-projection-requested':
      await runVisibleRuntimeProjectionRefresh(get, intent.id, intent.repoInstanceId)
      return
  }
  const exhaustive: never = intent
  return exhaustive
}
