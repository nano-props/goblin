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
import type { RepoSnapshot } from '#/shared/api-types.ts'
import type { RepoState, ReposGet } from '#/web/stores/repos/types.ts'
import type { ExecResult, PullRequestFetchMode } from '#/web/types.ts'

function existingBranchNames(r: { data: { branches: Array<{ name: string }> } }): Set<string> {
  return new Set(r.data.branches.map((branch) => branch.name))
}

function finishPullRequestBranchDataLoads(
  r: {
    dataLoads: {
      pullRequestsByBranch: Record<string, ReturnType<typeof idlePullRequestDataLoad>>
    }
  },
  branchNames: string[],
  existingBranches: Set<string>,
  finish: (dataLoad: ReturnType<typeof idlePullRequestDataLoad>) => void,
  options?: { createMissing?: boolean },
): void {
  for (const branch of branchNames) {
    if (!existingBranches.has(branch)) {
      delete r.dataLoads.pullRequestsByBranch[branch]
      continue
    }
    const dataLoad = options?.createMissing
      ? (r.dataLoads.pullRequestsByBranch[branch] ??= idlePullRequestDataLoad())
      : r.dataLoads.pullRequestsByBranch[branch]
    if (dataLoad) finish(dataLoad)
  }
}

export function applySnapshotToRepoProjection(r: RepoState, snap: RepoSnapshot, validBranches: Set<string>): void {
  const selectedWorktreeRetarget = selectedWorktreeBranchRetarget({
    previousBranches: r.data.branches,
    nextBranches: snap.branches,
    selectedBranch: r.ui.selectedBranch,
  })
  const selected = selectedBranchForBranchSet({
    branches: snap.branches,
    currentBranch: snap.current,
    selectedBranch: selectedWorktreeRetarget?.toBranchName ?? r.ui.selectedBranch,
    viewMode: r.ui.branchViewMode,
  })
  const branches = stripBranchWorktreeMetadata(snap.branches)
  const branchNames = branches.map((branch) => branch.name)
  r.data.branches = branches
  r.data.currentBranch = snap.current
  r.data.currentHEAD = snap.currentHEAD
  r.data.worktreesByPath = worktreeStatesFromBranches(snap.branches, r.data.worktreesByPath, r.data.status)
  r.dataLoads.pullRequestsByBranch = Object.fromEntries(
    Object.entries(r.dataLoads.pullRequestsByBranch).filter(([branch]) => validBranches.has(branch)),
  )
  pruneRepoOperationViewsForBranches(r.operations, validBranches)
  r.ui.selectedBranch = selected
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
  finishDataLoadSuccess(r.dataLoads.snapshot)
}

function selectedWorktreeBranchRetarget(input: {
  previousBranches: RepoState['data']['branches']
  nextBranches: RepoSnapshot['branches']
  selectedBranch: string | null
}): { fromBranchName: string; toBranchName: string } | null {
  if (!input.selectedBranch) return null
  const previousWorktreePath = input.previousBranches.find((branch) => branch.name === input.selectedBranch)?.worktree
    ?.path
  if (!previousWorktreePath) return null
  const nextBranch = input.nextBranches.find((branch) => branch.worktree?.path === previousWorktreePath)
  if (!nextBranch || nextBranch.name === input.selectedBranch) return null
  return { fromBranchName: input.selectedBranch, toBranchName: nextBranch.name }
}

export function startPullRequestRefreshDataLoads(
  r: RepoState,
  branchNames: string[],
  mode: PullRequestFetchMode,
): void {
  startPullRequestDataLoad(r.dataLoads.pullRequests, mode, {
    hasData: false,
  })
  for (const branch of branchNames) {
    r.dataLoads.pullRequestsByBranch[branch] ??= idlePullRequestDataLoad()
    startPullRequestDataLoad(r.dataLoads.pullRequestsByBranch[branch], mode, {
      hasData: false,
    })
  }
}

export function shouldAttemptFetch(repo: RepoState | null | undefined, repoInstanceId: string): boolean {
  return !!repo && repo.instanceId === repoInstanceId && repo.remote.hasRemotes === true && !isRepoUnavailable(repo)
}

export function repoIfFresh(get: ReposGet, id: string, repoInstanceId: string): RepoState | null {
  const repo = get().repos[id]
  return repo && repo.instanceId === repoInstanceId ? repo : null
}

export function resolveActionRepoInstanceId(
  get: ReposGet,
  id: string,
  requestedRepoInstanceId?: string,
): { repo: RepoState; repoInstanceId: string } | null {
  const repo = get().repos[id]
  if (!repo) return null
  const repoInstanceId = requestedRepoInstanceId ?? repo.instanceId
  if (repo.instanceId !== repoInstanceId) return null
  return { repo, repoInstanceId }
}

export function applyFetchDataLoadResult(r: RepoState, result: ExecResult): void {
  if (result.ok) finishDataLoadSuccess(r.dataLoads.fetch)
  else if (result.message !== 'cancelled') finishDataLoadError(r.dataLoads.fetch, result.message)
  else cancelDataLoad(r.dataLoads.fetch)
}

export function applyFetchDataLoadError(r: RepoState, message: string): void {
  if (message === 'cancelled') cancelDataLoad(r.dataLoads.fetch)
  else finishDataLoadError(r.dataLoads.fetch, message)
}

export function applyPullRequestRefreshUnavailableState(
  r: RepoState,
  branchNames: string[],
  mode: PullRequestFetchMode,
): void {
  const existingBranches = existingBranchNames(r)
  finishPullRequestDataLoadUnavailable(r.dataLoads.pullRequests, mode)
  finishPullRequestBranchDataLoads(r, branchNames, existingBranches, (dataLoad) =>
    finishPullRequestDataLoadUnavailable(dataLoad, mode),
  )
}

export function applyPullRequestRefreshSuccessState(
  r: RepoState,
  branchNames: string[],
  mode: PullRequestFetchMode,
): void {
  const existingBranches = existingBranchNames(r)
  finishPullRequestDataLoadSuccess(r.dataLoads.pullRequests, mode)
  finishPullRequestBranchDataLoads(
    r,
    branchNames,
    existingBranches,
    (dataLoad) => finishPullRequestDataLoadSuccess(dataLoad, mode),
    { createMissing: true },
  )
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
  finishPullRequestBranchDataLoads(r, currentBranches, existingBranches, (dataLoad) =>
    finishPullRequestDataLoadUnavailable(dataLoad, mode),
  )
}

export function applyPullRequestRefreshErrorState(
  r: RepoState,
  branchNames: string[],
  mode: PullRequestFetchMode,
  message: string,
): void {
  finishPullRequestDataLoadError(r.dataLoads.pullRequests, message)
  finishPullRequestBranchDataLoads(r, branchNames, existingBranchNames(r), (dataLoad) =>
    finishPullRequestDataLoadError(dataLoad, message),
  )
}

export function canRunRemoteFetchNow(repo: RepoState): boolean {
  return canStartRemoteFetch(repo)
}
