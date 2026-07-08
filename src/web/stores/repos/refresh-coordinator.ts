import type { RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import type { RepoState, ReposGet } from '#/web/stores/repos/types.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { invalidateRepoDataQueries, invalidateRepoRuntimeProjectionQueries } from '#/web/repo-data-query.ts'

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
      reason: 'visible-projection-view-opened' | 'visible-projection-branch-changed'
      branchName: string | null
    })

export interface RepoVisibleProjectionRefreshState {
  id: string
  repoInstanceId: string
  preferredWorkspacePaneTab: WorkspacePaneTabType | null
  renderedWorkspacePaneTab: WorkspacePaneTabType | null
  branchName: string | null
  visibleProjectionViewOpen: boolean
  unavailable: boolean
  visibleStatusPhase: 'idle' | 'loading' | 'refreshing'
}

export function isRepoVisibleProjectionRefreshable(repo: RepoVisibleProjectionRefreshState): boolean {
  return !repo.unavailable && repo.visibleStatusPhase === 'idle'
}

function isRepoStateVisibleProjectionRefreshable(repo: RepoState): boolean {
  return !isRepoUnavailable(repo) && repo.dataLoads.visibleStatus.phase === 'idle'
}

async function runVisibleRuntimeProjectionRefresh(
  get: ReposGet,
  id: string,
  repoInstanceId: string,
  branchName: string | null,
): Promise<void> {
  const state = get()
  const repo = state.repos[id]
  if (!repo || repo.instanceId !== repoInstanceId) return
  if (!isRepoStateVisibleProjectionRefreshable(repo)) return
  await state.refreshRuntimeProjection(id, { repoInstanceId, scope: 'visible-status', branchName })
}

export function requestVisibleRepoProjectionRefresh(get: ReposGet, id: string, branchName: string | null): void {
  const repo = get().repos[id]
  if (!repo) return
  void runRepoRefreshIntent(get, {
    kind: 'visible-runtime-projection-requested',
    reason: 'visible-projection-view-opened',
    id,
    repoInstanceId: repo.instanceId,
    branchName,
  })
}

export async function handleRepoInvalidationRefresh(
  get: ReposGet,
  event: Pick<RepoQueryInvalidationEvent, 'repoId' | 'query'>,
  repoInstanceId: string,
): Promise<void> {
  const repoId = event.repoId
  const repo = get().repos[repoId]
  if (!repo || repo.instanceId !== repoInstanceId || isRepoUnavailable(repo)) return
  if (event.query === 'repo-runtime') {
    invalidateRepoRuntimeProjectionQueries(repoId, repoInstanceId)
    return
  }
  invalidateRepoDataQueries(repoId, repoInstanceId)
  await get().refreshCoreData(repoId, { repoInstanceId })
}

export function resetRepoRefreshCoordinatorState(): void {}

export async function runRepoRefreshIntent(get: ReposGet, intent: RepoRefreshIntent): Promise<void> {
  switch (intent.kind) {
    case 'manual-refresh-requested':
      await get().syncAndRefresh(intent.id, { repoInstanceId: intent.repoInstanceId })
      return
    case 'core-data-changed':
      await get().refreshCoreData(intent.id, { repoInstanceId: intent.repoInstanceId })
      return
    case 'visible-runtime-projection-requested':
      await runVisibleRuntimeProjectionRefresh(get, intent.id, intent.repoInstanceId, intent.branchName)
      return
  }
  const exhaustive: never = intent
  return exhaustive
}
