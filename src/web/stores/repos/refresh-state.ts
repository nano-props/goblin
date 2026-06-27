import { markRepoAvailable } from '#/web/stores/repos/availability.ts'
import { selectedBranchForBranchSet } from '#/web/stores/repos/branch-view-mode.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import { pruneRepoOperationViewsForBranches } from '#/web/stores/repos/operations.ts'
import {
  cancelDataLoad,
  finishPullRequestDataLoadError,
  finishPullRequestDataLoadSuccess,
  finishPullRequestDataLoadUnavailable,
  finishDataLoadError,
  finishDataLoadSuccess,
  idlePullRequestDataLoad,
  startPullRequestDataLoad,
} from '#/web/stores/repos/repo-data-load-state.ts'
import { canStartRemoteFetch } from '#/web/stores/repos/sync-state.ts'
import { stripBranchWorktreeMetadata, worktreeStatesFromBranches } from '#/web/stores/repos/worktree-state.ts'
import { normalizeWorkspacePaneTabOrderRecord } from '#/web/stores/repos/workspace-pane-tabs.ts'
import { branchPullRequestBelongsToBranch } from '#/shared/git-types.ts'
import type { RepoSnapshot } from '#/shared/api-types.ts'
import type { RepoState, ReposGet } from '#/web/stores/repos/types.ts'
import type { ExecResult, PullRequestFetchMode, PullRequestInfo } from '#/web/types.ts'

function mergePullRequest(
  previous: { pullRequest?: PullRequestInfo },
  next: PullRequestInfo,
  mode: PullRequestFetchMode,
): PullRequestInfo {
  const existing = previous.pullRequest
  const preserveExistingDetails =
    mode !== 'full' && !!existing && existing.number === next.number && existing.url === next.url
  if (!preserveExistingDetails) return next
  return {
    ...next,
    checks: existing.checks ?? next.checks,
    reviewDecision: existing.reviewDecision === undefined ? next.reviewDecision : existing.reviewDecision,
    mergeable: existing.mergeable ?? next.mergeable,
  }
}

export function existingBranchNames(r: { data: { branches: Array<{ name: string }> } }): Set<string> {
  return new Set(r.data.branches.map((branch) => branch.name))
}

export function finishPullRequestBranchResources(
  r: {
    resources: {
      pullRequestsByBranch: Record<string, ReturnType<typeof idlePullRequestDataLoad>>
    }
  },
  branchNames: string[],
  existingBranches: Set<string>,
  finish: (resource: ReturnType<typeof idlePullRequestDataLoad>) => void,
  options?: { createMissing?: boolean },
): void {
  for (const branch of branchNames) {
    if (!existingBranches.has(branch)) {
      delete r.resources.pullRequestsByBranch[branch]
      continue
    }
    const resource = options?.createMissing
      ? (r.resources.pullRequestsByBranch[branch] ??= idlePullRequestDataLoad())
      : r.resources.pullRequestsByBranch[branch]
    if (resource) finish(resource)
  }
}

export function applySnapshotToRepoProjection(r: RepoState, snap: RepoSnapshot, validBranches: Set<string>): void {
  const selected = selectedBranchForBranchSet({
    branches: snap.branches,
    currentBranch: snap.current,
    selectedBranch: r.ui.selectedBranch,
    viewMode: r.ui.branchViewMode,
  })
  const preservePullRequests = snap.remote ? snap.remote.hasGitHubRemote === true : r.remote.hasGitHubRemote === true
  const pullRequestsByBranch = preservePullRequests
    ? new Map(
        r.data.branches.flatMap((branch) => (branch.pullRequest ? [[branch.name, branch.pullRequest] as const] : [])),
      )
    : new Map()
  const branchesWithSnapshotWorktreeMetadata = snap.branches.map((branch) => {
    const pullRequest = branch.pullRequest ?? pullRequestsByBranch.get(branch.name)
    return pullRequest && branchPullRequestBelongsToBranch(branch, pullRequest) ? { ...branch, pullRequest } : branch
  })
  const branches = stripBranchWorktreeMetadata(branchesWithSnapshotWorktreeMetadata)
  const branchNames = branches.map((branch) => branch.name)
  r.data.branches = branches
  r.data.currentBranch = snap.current
  r.data.currentHEAD = snap.currentHEAD
  r.data.worktreesByPath = worktreeStatesFromBranches(
    branchesWithSnapshotWorktreeMetadata,
    r.data.worktreesByPath,
    r.data.status,
  )
  r.resources.pullRequestsByBranch = Object.fromEntries(
    Object.entries(r.resources.pullRequestsByBranch).filter(([branch]) => validBranches.has(branch)),
  )
  pruneRepoOperationViewsForBranches(r.operations, validBranches)
  r.ui.selectedBranch = selected
  r.ui.workspacePaneTabOrderByBranch = normalizeWorkspacePaneTabOrderRecord(
    r.ui.workspacePaneTabOrderByBranch,
    branchNames,
  )
  if (snap.remote) {
    r.remote.remotes = snap.remote.remotes.map((remote) => remote.name)
    r.remote.remoteDetails = snap.remote.remotes
    r.remote.hasRemotes = snap.remote.hasRemotes
    r.remote.hasBrowserRemote = snap.remote.hasBrowserRemote
    r.remote.browserRemoteProvider = snap.remote.browserRemoteProvider
    r.remote.remoteProviders = snap.remote.remoteProviders
    r.remote.hasGitHubRemote = snap.remote.hasGitHubRemote
    if (!snap.remote.hasRemotes) {
      r.remote.fetchFailed = false
      r.remote.fetchError = null
    }
  }
  markRepoAvailable(r)
  r.projection.source = 'fresh'
  r.projection.savedAt = null
  finishDataLoadSuccess(r.resources.snapshot)
}

export function startPullRequestRefreshResources(
  r: RepoState,
  branchNames: string[],
  requested: Set<string>,
  mode: PullRequestFetchMode,
): void {
  startPullRequestDataLoad(r.resources.pullRequests, mode, {
    hasData: r.data.branches.some((branch) => requested.has(branch.name) && !!branch.pullRequest),
  })
  for (const branch of branchNames) {
    r.resources.pullRequestsByBranch[branch] ??= idlePullRequestDataLoad()
    const branchState = r.data.branches.find((item) => item.name === branch)
    startPullRequestDataLoad(r.resources.pullRequestsByBranch[branch], mode, {
      hasData: !!branchState?.pullRequest,
    })
  }
}

export function applyPullRequestEntries(
  r: RepoState,
  entries: Array<{ branch: string; pullRequest: PullRequestInfo }>,
  requested: Set<string>,
  clearMissing: boolean,
  mode: PullRequestFetchMode,
): void {
  const byBranch = new Map(entries.map((entry) => [entry.branch, entry.pullRequest]))
  for (const branch of r.data.branches) {
    const pullRequest = byBranch.get(branch.name)
    if (pullRequest) {
      if (branchPullRequestBelongsToBranch(branch, pullRequest))
        branch.pullRequest = mergePullRequest(branch, pullRequest, mode)
      else branch.pullRequest = undefined
      continue
    }
    if (clearMissing && requested.has(branch.name) && branch.pullRequest) branch.pullRequest = undefined
  }
}

export function shouldAttemptFetch(repo: RepoState | null | undefined, token: number): boolean {
  return !!repo && repo.instanceToken === token && repo.remote.hasRemotes === true && !isRepoUnavailable(repo)
}

export function repoIfFresh(get: ReposGet, id: string, token: number): RepoState | null {
  const repo = get().repos[id]
  return repo && repo.instanceToken === token ? repo : null
}

export function resolveActionToken(
  get: ReposGet,
  id: string,
  token?: number,
): { repo: RepoState; token: number } | null {
  const repo = get().repos[id]
  if (!repo) return null
  const nextToken = token ?? repo.instanceToken
  if (repo.instanceToken !== nextToken) return null
  return { repo, token: nextToken }
}

export function applyFetchResourceResult(r: RepoState, result: ExecResult): void {
  if (result.ok) finishDataLoadSuccess(r.resources.fetch)
  else if (result.message !== 'cancelled') finishDataLoadError(r.resources.fetch, result.message)
  else cancelDataLoad(r.resources.fetch)
}

export function applyFetchResourceError(r: RepoState, message: string): void {
  if (message === 'cancelled') cancelDataLoad(r.resources.fetch)
  else finishDataLoadError(r.resources.fetch, message)
}

export function applyPullRequestRefreshUnavailableState(
  r: RepoState,
  branchNames: string[],
  mode: PullRequestFetchMode,
): void {
  const existingBranches = existingBranchNames(r)
  finishPullRequestDataLoadUnavailable(r.resources.pullRequests, mode)
  finishPullRequestBranchResources(r, branchNames, existingBranches, (resource) =>
    finishPullRequestDataLoadUnavailable(resource, mode),
  )
}

export function applyPullRequestRefreshSuccessState(
  r: RepoState,
  branchNames: string[],
  entries: Array<{ branch: string; pullRequest: PullRequestInfo }>,
  requested: Set<string>,
  clearMissing: boolean,
  mode: PullRequestFetchMode,
): void {
  const existingBranches = existingBranchNames(r)
  finishPullRequestDataLoadSuccess(r.resources.pullRequests, mode)
  finishPullRequestBranchResources(
    r,
    branchNames,
    existingBranches,
    (resource) => finishPullRequestDataLoadSuccess(resource, mode),
    { createMissing: true },
  )
  applyPullRequestEntries(r, entries, requested, clearMissing, mode)
}

export function applyPullRequestRefreshStaleState(
  r: RepoState,
  branchNames: string[],
  mode: PullRequestFetchMode,
  operationId: number,
): void {
  const existingBranches = existingBranchNames(r)
  const currentBranches = branchNames.filter(
    (branch) => r.operations.pullRequestsByBranch[branch]?.operationId === operationId,
  )
  finishPullRequestBranchResources(r, currentBranches, existingBranches, (resource) =>
    finishPullRequestDataLoadUnavailable(resource, mode),
  )
}

export function applyPullRequestRefreshErrorState(
  r: RepoState,
  branchNames: string[],
  mode: PullRequestFetchMode,
  message: string,
): void {
  finishPullRequestDataLoadError(r.resources.pullRequests, message)
  finishPullRequestBranchResources(r, branchNames, existingBranchNames(r), (resource) =>
    finishPullRequestDataLoadError(resource, message),
  )
}

export function canRunRemoteFetchNow(repo: RepoState): boolean {
  return canStartRemoteFetch(repo)
}
