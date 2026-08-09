// Repo/store fixtures for tests that drive the authoritative Zustand and query projections.

import type { RepoSnapshot } from '#/shared/api-types.ts'
import type { RepoRemoteInfo } from '#/shared/git-types.ts'
import { DEFAULT_ZEN_MODE, DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'
import type { RemoteWorkspaceConnectionLifecycle } from '#/shared/remote-workspace.ts'
import { createOpaqueId } from '#/shared/opaque-id.ts'
import type { WorkspacePaneTabEntry, WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import {
  requiredGitWorkspacePaneTabsTarget,
  workspacePaneTabsTargetIdentityKey,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspaceProbeState } from '#/shared/workspace-runtime.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import {
  getRepoSnapshotQueryData,
  getRepoWorktreeStatusQueryData,
  setRepoSnapshotQueryData,
  setRepoWorktreeStatusQueryData,
} from '#/web/repo-query-cache.ts'
import { disposeAllRepoOperationSchedulers } from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import type { GitWorkspaceClientState, WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import type { BranchSnapshotInfo, PullRequestInfo, WorktreeStatus } from '#/shared/git-types.ts'

export type RepoPresentationForTest = WorkspaceState & {
  operations: GitWorkspaceClientState['operations']
  remoteLifecycle: Extract<WorkspaceState['admission'], { kind: 'remote' }>['lifecycle']
  branchAction: GitWorkspaceClientState['operations']['branchAction']
  snapshot: RepoSnapshot
  status: WorktreeStatus[] | undefined
}

interface RepoPresentationFactsForTest {
  branches: BranchSnapshotInfo[]
  currentBranch: string
  status?: WorktreeStatus[]
  remote?: Partial<RepoRemoteInfo>
}

export function repoPresentationForTest(
  repo: WorkspaceState,
  facts: RepoPresentationFactsForTest,
): RepoPresentationForTest {
  if (repo.capability.kind !== 'git') throw new Error(`test repo is not Git-capable: ${repo.id}`)
  const git = repo.capability.git
  return {
    ...repo,
    operations: git.operations,
    remoteLifecycle: repo.admission.kind === 'remote' ? repo.admission.lifecycle : null,
    branchAction: git.operations.branchAction,
    snapshot: testRepoSnapshot(facts.branches, facts.currentBranch, facts.remote),
    status: facts.status,
  }
}

export function createGitRepoPresentationForTest(
  repo: WorkspaceState,
  facts: RepoPresentationFactsForTest,
): RepoPresentationForTest {
  acceptWorkspaceProbeState(repo, createGitWorkspaceProbeForTest())
  return repoPresentationForTest(repo, facts)
}

export function repoPresentationFromQueryForTest(repo: WorkspaceState): RepoPresentationForTest {
  if (repo.capability.kind !== 'git') throw new Error(`test repo is not Git-capable: ${repo.id}`)
  const git = repo.capability.git
  const snapshot = getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)
  if (!snapshot) throw new Error(`missing repository snapshot for test repo: ${repo.id}`)
  return {
    ...repo,
    operations: git.operations,
    remoteLifecycle: repo.admission.kind === 'remote' ? repo.admission.lifecycle : null,
    branchAction: git.operations.branchAction,
    snapshot,
    status: getRepoWorktreeStatusQueryData(repo.id, repo.workspaceRuntimeId)?.status,
  }
}

export function seedRepoShellForTest(options: {
  id: string
  preferredWorkspacePaneTabByTarget?: Record<string, WorkspacePaneTabType | null>
  workspaceRuntimeId?: string
  remoteLifecycle?: RemoteWorkspaceConnectionLifecycle | null
  workspaceProbe?: WorkspaceProbeState
}): WorkspaceState {
  const workspaceId = workspaceIdForTest(options.id)
  const base = emptyWorkspace(workspaceId, options.workspaceRuntimeId ?? createOpaqueId('repo-runtime'))
  const repo: WorkspaceState = {
    ...base,
    ui: {
      ...base.ui,
      preferredWorkspacePaneTabByTarget:
        options.preferredWorkspacePaneTabByTarget ?? base.ui.preferredWorkspacePaneTabByTarget,
    },
  }
  acceptWorkspaceProbeState(repo, options.workspaceProbe ?? base.capability.probe)
  if (options.remoteLifecycle !== undefined && repo.admission.kind === 'remote') {
    repo.admission.lifecycle = options.remoteLifecycle
  }
  workspacesStore.setState({
    workspaces: { [workspaceId]: repo },
    workspaceOrder: [workspaceId],
    restoredWorkspaceId: workspaceId,
    workspaceMembershipReady: true,
    sessionPersistenceReady: true,
    sessionRestoreError: null,
    restoredClientWorkspaceBaseline: null,
    zenMode: DEFAULT_ZEN_MODE,
    workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
  })
  return repo
}

export function setWorkspaceProbeForTest(workspaceId: string, workspaceProbe: WorkspaceProbeState): void {
  workspacesStore.setState((state) => {
    const workspace = state.workspaces[workspaceId]
    if (!workspace) throw new Error(`Missing workspace fixture: ${workspaceId}`)
    const next = { ...workspace }
    acceptWorkspaceProbeState(next, workspaceProbe)
    return { workspaces: { ...state.workspaces, [workspaceId]: next } }
  })
}

export function createBranchSnapshot(name: string, options: Partial<BranchSnapshotInfo> = {}): BranchSnapshotInfo {
  return {
    name,
    isCurrent: false,
    ahead: 0,
    behind: 0,
    lastCommitHash: '',
    lastCommitShortHash: '',
    lastCommitMessage: '',
    lastCommitDate: '',
    lastCommitAuthor: '',
    ...options,
  }
}

export function createRepoBranch(name: string, options: Partial<BranchSnapshotInfo> = {}): BranchSnapshotInfo {
  return createBranchSnapshot(name, options)
}

export function createGitWorkspaceProbeForTest(): WorkspaceProbeState {
  return {
    status: 'ready',
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
    },
    diagnostics: [],
  }
}

export function createPullRequest(number: number, options: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/repo/pull/${number}`,
    state: 'open',
    ...options,
  }
}

export function resetWorkspacesStore(): void {
  disposeAllRepoOperationSchedulers()
  appQueryClient.clear()
  workspacesStore.setState({
    workspaces: {},
    workspaceOrder: [],
    restoredWorkspaceId: null,
    workspaceMembershipReady: false,
    sessionPersistenceReady: false,
    sessionRestoreError: null,
    restoredClientWorkspaceBaseline: null,
    zenMode: DEFAULT_ZEN_MODE,
    workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
    selectedTerminalSessionIdByTerminalFilesystemTarget: {},
    branchViewModeByWorkspace: {},
    tabOpenerIdentityByScope: {},
    navigationHistoryByWorkspace: {},
  })
}

export function seedRepoWithReadModelForTest(options: {
  id: string
  branches?: BranchSnapshotInfo[]
  branchSnapshots?: BranchSnapshotInfo[]
  currentBranch?: string
  currentBranchName?: string | null
  preferredWorkspacePaneTab?: WorkspacePaneTabType | null
  preferredWorkspacePaneTabByTarget?: Record<string, WorkspacePaneTabType | null>
  workspacePaneTabsByBranch?: Record<string, WorkspacePaneTabEntry[]>
  workspaceRuntimeId?: string
  status?: WorktreeStatus[]
  remote?: Partial<RepoRemoteInfo>
  remoteLifecycle?: RemoteWorkspaceConnectionLifecycle | null
  workspaceProbe?: WorkspaceProbeState
}): WorkspaceState {
  const workspaceId = workspaceIdForTest(options.id)
  const branchesWithSnapshotWorktreeMetadata = options.branchSnapshots ?? options.branches ?? []
  const status = options.status ?? []
  const currentBranchName = options.currentBranchName ?? null
  const preferredWorkspacePaneTabByTarget =
    options.preferredWorkspacePaneTabByTarget ??
    (currentBranchName && options.preferredWorkspacePaneTab !== undefined
      ? {
          [workspacePaneTabsTargetIdentityKey(
            requiredGitWorkspacePaneTabsTarget(
              workspaceId,
              currentBranchName,
              branchesWithSnapshotWorktreeMetadata.find((branch) => branch.name === currentBranchName)?.worktree
                ?.path ?? null,
            ),
          )]: options.preferredWorkspacePaneTab,
        }
      : undefined)
  const repo = seedRepoShellForTest({
    id: options.id,
    workspaceRuntimeId: options.workspaceRuntimeId,
    ...(preferredWorkspacePaneTabByTarget ? { preferredWorkspacePaneTabByTarget } : {}),
    remoteLifecycle: options.remoteLifecycle,
    workspaceProbe: options.workspaceProbe ?? {
      status: 'ready',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
      },
      diagnostics: [],
    },
  })
  seedRepoQueryDataForTest(repo, {
    branches: branchesWithSnapshotWorktreeMetadata,
    currentBranch: options.currentBranch ?? currentBranchName ?? '',
    status,
    remote: options.remote,
  })
  for (const [branchName, tabs] of Object.entries(options.workspacePaneTabsByBranch ?? {})) {
    const branch = branchesWithSnapshotWorktreeMetadata.find((candidate) => candidate.name === branchName)
    if (!branch) continue
    setWorkspacePaneTabsForTargetQueryData({
      ...requiredGitWorkspacePaneTabsTarget(repo.id, branchName, branch.worktree?.path ?? null),
      workspaceRuntimeId: repo.workspaceRuntimeId,
      tabs,
    })
  }
  return repo
}

export function seedRepoQueryDataForTest(
  repo: Pick<WorkspaceState, 'id' | 'workspaceRuntimeId'>,
  readModel: {
    branches: BranchSnapshotInfo[]
    currentBranch: string
    status?: WorktreeStatus[]
    remote?: Partial<RepoRemoteInfo>
  },
): void {
  const loadedAt = Date.now()
  setRepoSnapshotQueryData(
    repo.id,
    repo.workspaceRuntimeId,
    testRepoSnapshot(readModel.branches, readModel.currentBranch, readModel.remote),
  )
  setRepoWorktreeStatusQueryData(repo.id, repo.workspaceRuntimeId, {
    workspaceRuntimeId: repo.workspaceRuntimeId,
    status: readModel.status ?? [],
    loadedAt,
  })
}

function testRepoSnapshot(
  branches: BranchSnapshotInfo[],
  current: string,
  remote: Partial<RepoRemoteInfo> = {},
): RepoSnapshot {
  return {
    branches,
    current,
    remote: {
      remotes: [],
      hasRemotes: false,
      hasBrowserRemote: false,
      remoteProviders: {},
      hasGitHubRemote: false,
      ...remote,
    },
  }
}
