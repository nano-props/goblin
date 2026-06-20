import type { RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import {
  shouldSuppressRepoInvalidationSource,
  resetRepoInvalidationSourceState,
} from '#/web/stores/repos/invalidation-sources.ts'
import { isRepoUnavailable } from '#/web/stores/repos/helpers.ts'
import type { RepoState, ReposGet } from '#/web/stores/repos/types.ts'
import type { WorkspacePaneView } from '#/shared/workspace-pane.ts'

interface RepoRefreshIntentBase {
  id: string
  token: number
}

type CoreRepoRefreshReason = 'initial-load' | 'branch-action'

export type RepoRefreshIntent =
  | (RepoRefreshIntentBase & { kind: 'core-data-changed'; reason: CoreRepoRefreshReason })
  | (RepoRefreshIntentBase & { kind: 'manual-refresh-requested' })
  | (RepoRefreshIntentBase & { kind: 'visible-pull-request-changed'; branch: string | null })
  | (RepoRefreshIntentBase & { kind: 'visible-status-like-view-opened' })

type RepoInvalidationRefreshDisposition = 'refresh' | 'suppress'

export interface RepoStatusRefreshSnapshot {
  id: string
  token: number
  workspacePaneView: WorkspacePaneView
  statusViewOpen: boolean
  unavailable: boolean
  statusPhase: 'idle' | 'loading' | 'refreshing'
}

export function repoStatusRefreshSnapshot(repo: RepoState): RepoStatusRefreshSnapshot {
  return {
    id: repo.id,
    token: repo.instanceToken,
    workspacePaneView: repo.ui.preferredWorkspacePaneView,
    statusViewOpen: repo.ui.openBranchWorkspacePaneViews.includes('status'),
    unavailable: isRepoUnavailable(repo),
    statusPhase: repo.resources.status.phase,
  }
}

export function isRepoStatusRefreshable(repo: RepoStatusRefreshSnapshot): boolean {
  return !repo.unavailable && repo.statusPhase === 'idle'
}

async function runVisiblePullRequestRefresh(
  get: ReposGet,
  id: string,
  branch: string | null | undefined,
  token: number,
): Promise<void> {
  if (!branch) return
  await get().refreshPullRequests(id, [branch], { token, mode: 'full' })
}

async function runVisibleStatusRefresh(get: ReposGet, id: string, token: number): Promise<void> {
  const state = get()
  if (state.activeId !== id) return
  const repo = state.repos[id]
  if (!repo || repo.instanceToken !== token) return
  if (!isRepoStatusRefreshable(repoStatusRefreshSnapshot(repo))) return
  await state.refreshStatus(id, { token })
}

export function requestVisibleRepoStatusRefresh(get: ReposGet, id: string): void {
  const repo = get().repos[id]
  if (!repo) return
  void runRepoRefreshIntent(get, {
    kind: 'visible-status-like-view-opened',
    id,
    token: repo.instanceToken,
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
  token: number,
): Promise<void> {
  const repoId = event.repoId
  const repo = get().repos[repoId]
  if (!repo || repo.instanceToken !== token || isRepoUnavailable(repo)) return
  const disposition = repoInvalidationRefreshDisposition(event)
  if (disposition !== 'refresh') return
  await get().refreshCoreData(repoId, { token })
}

export function resetRepoRefreshCoordinatorState(): void {
  resetRepoInvalidationSourceState()
}

export async function runRepoRefreshIntent(get: ReposGet, intent: RepoRefreshIntent): Promise<void> {
  switch (intent.kind) {
    case 'manual-refresh-requested':
      await get().syncAndRefresh(intent.id, { token: intent.token })
      return
    case 'core-data-changed':
      await get().refreshCoreData(intent.id, { token: intent.token })
      return
    case 'visible-pull-request-changed':
      await runVisiblePullRequestRefresh(get, intent.id, intent.branch, intent.token)
      return
    case 'visible-status-like-view-opened':
      await runVisibleStatusRefresh(get, intent.id, intent.token)
      return
  }
  const exhaustive: never = intent
  return exhaustive
}
