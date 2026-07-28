import type { RepoSnapshot, RepoSnapshotResponse } from '#/shared/api-types.ts'
import type { BranchSnapshotInfo, RepoRemoteInfo } from '#/shared/git-types.ts'
import {
  createBranchSnapshot,
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/repo-store.ts'
import { installGoblinTestBridge, type IpcTestHandler } from '#/web/test-utils/bridge.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { replaceWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { getRepoSnapshotQueryData, getRepoWorktreeStatusQueryData } from '#/web/repo-query-cache.ts'
import type { WorktreeStatus } from '#/web/types.ts'

export const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-test-repo')
export const ipcHandlers: Record<string, IpcTestHandler> = {}
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
  return repo
    ? (getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)?.branches.map((candidate) => candidate.name) ?? [])
    : []
}

export function repoCurrentBranch(): string | null {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  return repo ? (getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)?.current ?? null) : null
}

export function cachedRepoSnapshot(workspaceRuntimeId: string): RepoSnapshot | undefined {
  return getRepoSnapshotQueryData(REPO_ID, workspaceRuntimeId, primaryWindowQueryClient)
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

export function branch(name: string, options: Partial<BranchSnapshotInfo> = {}): BranchSnapshotInfo {
  return createBranchSnapshot(name, options)
}

export function repoSnapshotResponse(
  snapshot: Omit<RepoSnapshot, 'remote'> & { remote?: RepoRemoteInfo },
): RepoSnapshotResponse {
  return { snapshot: { ...snapshot, remote: snapshot.remote ?? testRemoteInfo() } }
}

export function seedRepo(branches: BranchSnapshotInfo[], workspaceRuntimeId = 'repo-runtime-test'): string {
  return seedRepoWithReadModelForTest({
    id: REPO_ID,
    branchSnapshots: branches,
    currentBranch: branches[0]?.name ?? '',
    workspaceRuntimeId,
    remote: {
      remotes: [
        {
          name: 'origin',
          fetchUrl: 'https://example.invalid/repository.git',
          pushUrl: 'https://example.invalid/repository.git',
        },
      ],
      hasRemotes: true,
      hasBrowserRemote: true,
      browserRemoteProvider: 'github',
      remoteProviders: { origin: 'github' },
      hasGitHubRemote: true,
    },
  }).workspaceRuntimeId
}

function testRemoteInfo(): RepoRemoteInfo {
  return {
    remotes: [],
    hasRemotes: false,
    hasBrowserRemote: false,
    remoteProviders: {},
    hasGitHubRemote: false,
  }
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
