import type { BranchSnapshotInfo, PullRequestInfo } from '#/web/types.ts'
import {
  createBranchSnapshot,
  createPullRequest,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoState,
  type RpcTestHandler,
} from '#/web/stores/repos/test-utils.ts'
export const REPO_ID = '/tmp/gbl-test-repo'
export const rpcHandlers: Record<string, RpcTestHandler> = {}
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

export function seedRepo(branches: BranchSnapshotInfo[], instanceToken = 1): number {
  return seedRepoState({
    id: REPO_ID,
    branchSnapshots: branches,
    instanceToken,
    remote: {
      remotes: ['origin'],
      hasRemotes: true,
      hasBrowserRemote: true,
      browserRemoteProvider: 'github',
      remoteProviders: { origin: 'github' },
      hasGitHubRemote: true,
    },
  }).instanceToken
}

export function resetRefreshTest(): void {
  for (const key of Object.keys(rpcHandlers)) delete rpcHandlers[key]
  resetReposStore()
  installGoblinTestBridge(rpcHandlers)
  rpcHandlers['repo.abort'] = async () => false
  rpcHandlers['repo.fetch'] = async () => ({ ok: true, message: 'ok' })
  rpcHandlers['repo.snapshot'] = async () => ({ branches: [], current: '' })
  rpcHandlers['repo.pullRequests'] = async () => []
  rpcHandlers['repo.status'] = async () => []
  rpcHandlers['terminal.create'] = async (input: { kind?: string }) => ({
    ok: true,
    action: input?.kind === 'primary' ? 'reused' : 'created',
    key: input?.kind === 'primary' ? 'repo\0worktree\0terminal-1' : 'repo\0worktree\0terminal-2',
    sessions: [],
  })
  rpcHandlers['terminal.prune'] = async () => ({ pruned: 0, remaining: 0 })
}
