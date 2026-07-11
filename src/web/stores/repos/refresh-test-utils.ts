import type { RepoRuntimeProjection, RepoSnapshot } from '#/shared/api-types.ts'
import type { BranchSnapshotInfo, PullRequestInfo, WorktreeStatus } from '#/web/types.ts'
import {
  createBranchSnapshot,
  createPullRequest,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoWithReadModelForTest,
  type IpcTestHandler,
} from '#/web/test-utils/bridge.ts'
export const REPO_ID = '/tmp/goblin-test-repo'
export const ipcHandlers: Record<string, IpcTestHandler> = {}
export const pullRequest = createPullRequest

export function branch(
  name: string,
  pullRequest?: PullRequestInfo,
  options: Partial<BranchSnapshotInfo> = {},
): BranchSnapshotInfo {
  return createBranchSnapshot(name, { ...options, ...(pullRequest ? { pullRequest } : {}) })
}

export function pullRequestWithHealth(number: number): PullRequestInfo {
  return createPullRequest(number, {
    checks: { total: 1, passing: 1, failing: 0, pending: 0 },
    reviewDecision: 'APPROVED',
    mergeable: 'MERGEABLE',
  })
}

export function repoProjection(
  snapshot: RepoSnapshot | null,
  status: WorktreeStatus[] = [],
  options: Partial<Pick<RepoRuntimeProjection, 'pullRequests' | 'operations' | 'requested' | 'loadedAt'>> = {},
): RepoRuntimeProjection {
  return {
    snapshot,
    status,
    pullRequests: options.pullRequests ?? null,
    operations: options.operations ?? { operations: [], loadedAt: 0 },
    requested: options.requested ?? { branch: null, pullRequestMode: 'full' },
    loadedAt: options.loadedAt ?? Date.now(),
  }
}

export function seedRepo(branches: BranchSnapshotInfo[], repoRuntimeId = 'repo-runtime-test'): string {
  return seedRepoWithReadModelForTest({
    id: REPO_ID,
    branchSnapshots: branches,
    repoRuntimeId,
    remote: {
      remotes: ['origin'],
      hasRemotes: true,
      hasBrowserRemote: true,
      browserRemoteProvider: 'github',
      remoteProviders: { origin: 'github' },
      hasGitHubRemote: true,
    },
  }).repoRuntimeId
}

export function resetRefreshTest(): void {
  for (const key of Object.keys(ipcHandlers)) delete ipcHandlers[key]
  resetReposStore()
  installGoblinTestBridge(ipcHandlers)
  ipcHandlers['repo.abort'] = async () => false
  ipcHandlers['repo.fetch'] = async () => ({ ok: true, message: 'ok' })
  // Tests that need repo read responses install `repo.projection`
  // directly; snapshot/status are no longer standalone read routes.
  ipcHandlers['terminal.prune'] = async () => ({ pruned: 0, remaining: 0 })
}
