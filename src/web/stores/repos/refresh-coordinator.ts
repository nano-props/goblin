import { waitForRepoOperationsIdle } from '#/web/stores/repos/runtime.ts'
import type { RepoState, ReposGet } from '#/web/stores/repos/types.ts'

interface RepoRefreshIntentBase {
  id: string
  token: number
}

type CoreRepoRefreshReason = 'initial-load' | 'branch-action' | 'repo-invalidated'

export type RepoRefreshIntent =
  | (RepoRefreshIntentBase & { kind: 'core-data-changed'; reason: CoreRepoRefreshReason })
  | (RepoRefreshIntentBase & { kind: 'manual-refresh-requested' })
  | (RepoRefreshIntentBase & { kind: 'visible-pull-request-changed'; branch: string | null })

type RepoInvalidationRefreshDisposition = 'refresh' | 'defer' | 'suppress'

interface PendingBranchActionInvalidation {
  token: number
  refreshStartedAt: number
  refreshSettledAt: number | null
}

const BRANCH_ACTION_INVALIDATION_SUPPRESSION_WINDOW_MS = 2_000
const pendingBranchActionInvalidations = new Map<string, PendingBranchActionInvalidation>()

async function runCoreRepoRefresh(get: ReposGet, id: string, token: number): Promise<void> {
  await Promise.all([get().refreshSnapshot(id, { token }), get().refreshStatus(id, { token })])
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

function pendingBranchActionInvalidation(repo: Pick<RepoState, 'id' | 'instanceToken'>, now: number) {
  const pending = pendingBranchActionInvalidations.get(repo.id)
  if (!pending) return null
  if (pending.token !== repo.instanceToken) {
    pendingBranchActionInvalidations.delete(repo.id)
    return null
  }
  if (
    pending.refreshSettledAt !== null &&
    now - pending.refreshSettledAt > BRANCH_ACTION_INVALIDATION_SUPPRESSION_WINDOW_MS
  ) {
    pendingBranchActionInvalidations.delete(repo.id)
    return null
  }
  return pending
}

function coreRefreshFinishedAfter(
  resource: Pick<RepoState['resources']['snapshot'], 'loadedAt' | 'stale'>,
  startedAt: number,
): boolean {
  return resource.loadedAt !== null && resource.loadedAt >= startedAt && !resource.stale
}

export function recordBranchActionCoreRefreshStart(id: string, token: number, now: number = Date.now()): void {
  pendingBranchActionInvalidations.set(id, {
    token,
    refreshStartedAt: now,
    refreshSettledAt: null,
  })
}

export function recordBranchActionCoreRefreshSettled(id: string, token: number, now: number = Date.now()): void {
  const pending = pendingBranchActionInvalidations.get(id)
  if (!pending || pending.token !== token) return
  pending.refreshSettledAt = now
}

export function repoInvalidationRefreshDisposition(
  repo: Pick<RepoState, 'id' | 'instanceToken' | 'resources'>,
  now: number = Date.now(),
): RepoInvalidationRefreshDisposition {
  const pending = pendingBranchActionInvalidation(repo, now)
  if (!pending) return 'refresh'
  if (pending.refreshSettledAt === null) return 'defer'
  if (
    coreRefreshFinishedAfter(repo.resources.snapshot, pending.refreshStartedAt) &&
    coreRefreshFinishedAfter(repo.resources.status, pending.refreshStartedAt)
  ) {
    pendingBranchActionInvalidations.delete(repo.id)
    return 'suppress'
  }
  pendingBranchActionInvalidations.delete(repo.id)
  return 'refresh'
}

export async function handleRepoInvalidationRefresh(get: ReposGet, repoId: string, token: number): Promise<void> {
  const repo = get().repos[repoId]
  if (!repo || repo.instanceToken !== token || repo.availability.phase === 'unavailable') return
  const disposition = repoInvalidationRefreshDisposition(repo)
  if (disposition === 'suppress') return
  if (disposition === 'defer') {
    try {
      await waitForRepoOperationsIdle(repoId, ['snapshot', 'status'])
    } catch {
      return
    }
    const repoAfterWait = get().repos[repoId]
    if (!repoAfterWait || repoAfterWait.instanceToken !== token || repoAfterWait.availability.phase === 'unavailable') return
    if (repoInvalidationRefreshDisposition(repoAfterWait) === 'suppress') return
  }
  await runRepoRefreshIntent(get, { kind: 'core-data-changed', reason: 'repo-invalidated', id: repoId, token })
}

export function resetRepoRefreshCoordinatorState(): void {
  pendingBranchActionInvalidations.clear()
}

export async function runRepoRefreshIntent(get: ReposGet, intent: RepoRefreshIntent): Promise<void> {
  switch (intent.kind) {
    case 'manual-refresh-requested':
      await get().syncAndRefresh(intent.id, { token: intent.token })
      return
    case 'core-data-changed': {
      const branchActionRefresh = intent.reason === 'branch-action'
      if (branchActionRefresh) recordBranchActionCoreRefreshStart(intent.id, intent.token)
      try {
        await runCoreRepoRefresh(get, intent.id, intent.token)
      } finally {
        if (branchActionRefresh) recordBranchActionCoreRefreshSettled(intent.id, intent.token)
      }
      return
    }
    case 'visible-pull-request-changed':
      await runVisiblePullRequestRefresh(get, intent.id, intent.branch, intent.token)
      return
  }
  const exhaustive: never = intent
  return exhaustive
}
