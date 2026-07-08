import type { RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { invalidateRepoDataQueries, invalidateRepoRuntimeProjectionQueries } from '#/web/repo-data-query.ts'
import {
  requestRepoProjectionReadModelRefresh,
  requestRepoRuntimeProjectionRefresh,
  runManualRepoSync,
  type RepoRefreshStoreAccess,
} from '#/web/stores/repos/refresh.ts'

interface RepoRefreshIntentBase {
  id: string
  repoRuntimeId: string
}

type RepoProjectionReadModelRefreshReason = 'initial-load' | 'branch-action'

export type RepoRefreshIntent =
  | (RepoRefreshIntentBase & {
      kind: 'projection-read-model-refresh-requested'
      reason: RepoProjectionReadModelRefreshReason
    })
  | (RepoRefreshIntentBase & { kind: 'manual-refresh-requested' })
  | (RepoRefreshIntentBase & {
      kind: 'visible-runtime-projection-requested'
      reason: 'visible-projection-view-opened' | 'visible-projection-branch-changed'
      branchName: string | null
    })

export interface RepoVisibleProjectionRefreshState {
  id: string
  repoRuntimeId: string
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
  store: RepoRefreshStoreAccess,
  id: string,
  repoRuntimeId: string,
  branchName: string | null,
): Promise<void> {
  const state = store.get()
  const repo = state.repos[id]
  if (!repo || repo.repoRuntimeId !== repoRuntimeId) return
  if (!isRepoStateVisibleProjectionRefreshable(repo)) return
  await requestRepoRuntimeProjectionRefresh(store, id, { repoRuntimeId, scope: 'visible-status', branchName })
}

export function requestVisibleRepoProjectionRefresh(
  store: RepoRefreshStoreAccess,
  id: string,
  branchName: string | null,
): void {
  const repo = store.get().repos[id]
  if (!repo) return
  void runRepoRefreshIntent(store, {
    kind: 'visible-runtime-projection-requested',
    reason: 'visible-projection-view-opened',
    id,
    repoRuntimeId: repo.repoRuntimeId,
    branchName,
  })
}

export async function handleRepoInvalidationRefresh(
  store: RepoRefreshStoreAccess,
  event: Pick<RepoQueryInvalidationEvent, 'repoId' | 'query'>,
  repoRuntimeId: string,
): Promise<void> {
  const repoId = event.repoId
  const repo = store.get().repos[repoId]
  if (!repo || repo.repoRuntimeId !== repoRuntimeId || isRepoUnavailable(repo)) return
  if (event.query === 'repo-runtime') {
    invalidateRepoRuntimeProjectionQueries(repoId, repoRuntimeId)
    return
  }
  invalidateRepoDataQueries(repoId, repoRuntimeId)
}

export function resetRepoRefreshCoordinatorState(): void {}

export async function runRepoRefreshIntent(store: RepoRefreshStoreAccess, intent: RepoRefreshIntent): Promise<void> {
  switch (intent.kind) {
    case 'manual-refresh-requested':
      await runManualRepoSync(store, intent.id, { repoRuntimeId: intent.repoRuntimeId })
      return
    case 'projection-read-model-refresh-requested':
      await requestRepoProjectionReadModelRefresh(store, intent.id, { repoRuntimeId: intent.repoRuntimeId })
      return
    case 'visible-runtime-projection-requested':
      await runVisibleRuntimeProjectionRefresh(store, intent.id, intent.repoRuntimeId, intent.branchName)
      return
  }
  const exhaustive: never = intent
  return exhaustive
}
