import type { GitWorkspaceRuntimeProjection, RepoSnapshot } from '#/shared/api-types.ts'
import type { BranchSnapshotInfo, PullRequestInfo } from '#/web/types.ts'
import {
  createBranchSnapshot,
  createPullRequest,
  installGoblinTestBridge,
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
  type IpcTestHandler,
} from '#/web/test-utils/bridge.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { replaceWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoProjectionQueryKey } from '#/web/repo-query-keys.ts'
import { getRepoWorktreeStatusQueryData } from '#/web/repo-query-cache.ts'
import type { WorktreeStatus } from '#/web/types.ts'

export const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-test-repo')
export const ipcHandlers: Record<string, IpcTestHandler> = {}
export const pullRequest = createPullRequest
export const refreshStoreAccess = { get: useWorkspacesStore.getState, set: useWorkspacesStore.setState }

type TestRepo = NonNullable<ReturnType<typeof useWorkspacesStore.getState>['workspaces'][string]>
type TestCreateWorktreeAction = Parameters<ReturnType<typeof useWorkspacesStore.getState>['runBranchAction']>[1]

export function updateRepoForTest(mutator: (repo: TestRepo) => void): void {
  useWorkspacesStore.setState((state) => {
    const repo = state.workspaces[REPO_ID]
    if (!repo) return state
    return { workspaces: { ...state.workspaces, [REPO_ID]: replaceWorkspace(repo, mutator) } }
  })
}

export function repoBranchNames(): string[] {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  return repo ? (readRepoBranchQueryProjection(repo)?.branches.map((candidate) => candidate.name) ?? []) : []
}

export function repoCurrentBranch(): string | null {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  return repo ? (readRepoBranchQueryProjection(repo)?.currentBranch ?? null) : null
}

export function cachedRepoProjection(
  workspaceRuntimeId: string,
  branchName: string | null = null,
): GitWorkspaceRuntimeProjection | undefined {
  return primaryWindowQueryClient.getQueryData<GitWorkspaceRuntimeProjection>(
    repoProjectionQueryKey(REPO_ID, workspaceRuntimeId, branchName, 'full'),
  )
}

export function cachedRepoStatus(workspaceRuntimeId: string): WorktreeStatus[] | undefined {
  return getRepoWorktreeStatusQueryData(REPO_ID, workspaceRuntimeId, primaryWindowQueryClient)?.status
}

export function createWorktreeAction(): TestCreateWorktreeAction {
  return {
    kind: 'createWorktree',
    input: {
      worktreePath: '/tmp/worktrees/feature-a',
      mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
    },
    worktreeBootstrap: { kind: 'skip' },
  }
}

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
  options: Partial<Pick<GitWorkspaceRuntimeProjection, 'pullRequests' | 'requested' | 'loadedAt'>> = {},
): GitWorkspaceRuntimeProjection {
  return {
    snapshot,
    pullRequests: options.pullRequests ?? null,
    requested: options.requested ?? { branch: null, pullRequestMode: 'full' },
    loadedAt: options.loadedAt ?? Date.now(),
  }
}

export function seedRepo(branches: BranchSnapshotInfo[], workspaceRuntimeId = 'repo-runtime-test'): string {
  return seedRepoWithReadModelForTest({
    id: REPO_ID,
    branchSnapshots: branches,
    workspaceRuntimeId,
    remote: {
      remotes: ['origin'],
      hasRemotes: true,
      hasBrowserRemote: true,
      browserRemoteProvider: 'github',
      remoteProviders: { origin: 'github' },
      hasGitHubRemote: true,
    },
  }).workspaceRuntimeId
}

export function resetRefreshTest(): void {
  for (const key of Object.keys(ipcHandlers)) delete ipcHandlers[key]
  resetWorkspacesStore()
  installGoblinTestBridge(ipcHandlers)
  ipcHandlers['repo.fetch'] = async () => ({ ok: true, message: 'ok' })
  ipcHandlers['settings.removeWorkspaceEntry'] = async () => ({
    openWorkspaceEntries: [],
    workspacePaneTabsByTargetByWorkspace: {},
  })
  ipcHandlers['repo.worktreeStatus'] = ({ workspaceRuntimeId }: { workspaceRuntimeId: string }) => ({
    workspaceRuntimeId,
    status: [],
    loadedAt: Date.now(),
  })
}
