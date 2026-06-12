import type { BranchSnapshotInfo, PullRequestInfo } from '#/web/types.ts'
import {
  createBranchSnapshot,
  createPullRequest,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoState,
  type IpcTestHandler,
} from '#/web/stores/repos/test-utils.ts'
export const REPO_ID = '/tmp/gbl-test-repo'
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
  for (const key of Object.keys(ipcHandlers)) delete ipcHandlers[key]
  resetReposStore()
  installGoblinTestBridge(ipcHandlers)
  ipcHandlers['repo.abort'] = async () => false
  ipcHandlers['repo.fetch'] = async () => ({ ok: true, message: 'ok' })
  ipcHandlers['repo.snapshot'] = async () => ({ branches: [], current: '' })
  ipcHandlers['repo.pullRequests'] = async () => []
  ipcHandlers['repo.status'] = async () => []
  // Composite read defaults to empty so the new `refreshCoreData` flow
  // works out of the box. Tests that care about the response set the
  // handler explicitly.
  ipcHandlers['repo.composite'] = async () => ({
    snapshot: { branches: [], current: '' },
    status: [],
    pullRequests: null,
  })
  ipcHandlers['terminal.create'] = async (input: { kind?: string }) => ({
    ok: true,
    action: input?.kind === 'primary' ? 'reused' : 'created',
    key: input?.kind === 'primary' ? 'repo\0worktree\0terminal-1' : 'repo\0worktree\0terminal-2',
    sessions: [],
  })
  ipcHandlers['terminal.prune'] = async () => ({ pruned: 0, remaining: 0 })
}
