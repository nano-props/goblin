// Repo/store fixtures for tests that drive the authoritative Zustand and query projections.

import type { GitWorkspaceRuntimeProjection } from '#/shared/api-types.ts'
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
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { readRepoBranchQueryProjection, type RepoBranchReadModelData } from '#/web/repo-branch-read-model.ts'
import { setRepoProjectionQueryData, setRepoWorktreeStatusQueryData } from '#/web/repo-query-cache.ts'
import { disposeAllRepoOperationSchedulers } from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import { resetAcceptedRepoProjectionReadModelState } from '#/web/stores/workspaces/projection-read-model-effects.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type {
  GitRemoteProjection,
  GitWorkspaceProjection,
  RepoBranchState,
  WorkspaceState,
} from '#/web/stores/workspaces/types.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { stripBranchWorktreeMetadata } from '#/web/stores/workspaces/worktree-state.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import type { BranchSnapshotInfo, PullRequestInfo, WorktreeStatus } from '#/web/types.ts'

export type RepoPresentationForTest = WorkspaceState & {
  operations: GitWorkspaceProjection['operations']
  remote: GitRemoteProjection
  remoteLifecycle: Extract<WorkspaceState['admission'], { kind: 'remote' }>['lifecycle']
  ui: WorkspaceState['ui'] & GitWorkspaceProjection['ui']
  branchAction: GitWorkspaceProjection['operations']['branchAction']
  branchModel: RepoBranchReadModelData
}

export function repoPresentationForTest(
  repo: WorkspaceState,
  branchReadModel: RepoBranchReadModelData,
): RepoPresentationForTest {
  if (repo.capability.kind !== 'git') throw new Error(`test repo is not Git-capable: ${repo.id}`)
  const git = repo.capability.git
  return {
    ...repo,
    operations: git.operations,
    remote: git.remote,
    remoteLifecycle: repo.admission.kind === 'remote' ? repo.admission.lifecycle : null,
    ui: { ...repo.ui, ...git.ui },
    branchAction: git.operations.branchAction,
    branchModel: branchReadModel,
  }
}

export function createGitRepoPresentationForTest(
  repo: WorkspaceState,
  branchReadModel: RepoBranchReadModelData,
): RepoPresentationForTest {
  acceptWorkspaceProbeState(repo, createGitWorkspaceProbeForTest())
  return repoPresentationForTest(repo, branchReadModel)
}

export function repoPresentationFromQueryForTest(repo: WorkspaceState): RepoPresentationForTest {
  if (repo.capability.kind !== 'git') throw new Error(`test repo is not Git-capable: ${repo.id}`)
  const git = repo.capability.git
  const readModel = readRepoBranchQueryProjection(repo)
  if (!readModel) throw new Error(`missing branch read model for test repo: ${repo.id}`)
  return {
    ...repo,
    operations: git.operations,
    remote: git.remote,
    remoteLifecycle: repo.admission.kind === 'remote' ? repo.admission.lifecycle : null,
    ui: { ...repo.ui, ...git.ui },
    branchAction: git.operations.branchAction,
    branchModel: readModel,
  }
}

export function seedRepoShellForTest(options: {
  id: string
  preferredWorkspacePaneTabByTarget?: Record<string, WorkspacePaneTabType | null>
  workspaceRuntimeId?: string
  remote?: Partial<GitRemoteProjection>
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
  if (repo.capability.kind === 'git' && options.remote) {
    repo.capability.git.remote = { ...repo.capability.git.remote, ...options.remote }
  }
  if (options.remoteLifecycle !== undefined && repo.admission.kind === 'remote') {
    repo.admission.lifecycle = options.remoteLifecycle
  }
  useWorkspacesStore.setState({
    workspaces: { [workspaceId]: repo },
    repoSnapshotCache: {},
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
  useWorkspacesStore.setState((state) => {
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

export function createRepoBranch(name: string, options: Partial<RepoBranchState> = {}): RepoBranchState {
  return stripBranchWorktreeMetadata([createBranchSnapshot(name, options)])[0]!
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
  resetAcceptedRepoProjectionReadModelState()
  primaryWindowQueryClient.clear()
  useWorkspacesStore.setState({
    workspaces: {},
    repoSnapshotCache: {},
    workspaceOrder: [],
    restoredWorkspaceId: null,
    workspaceMembershipReady: false,
    sessionPersistenceReady: false,
    sessionRestoreError: null,
    restoredClientWorkspaceBaseline: null,
    zenMode: DEFAULT_ZEN_MODE,
    workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
    selectedTerminalSessionIdByTerminalFilesystemTarget: {},
    tabOpenerIdentityByScope: {},
    navigationHistoryByWorkspace: {},
  })
}

export function seedRepoWithReadModelForTest(options: {
  id: string
  branches?: RepoBranchState[]
  branchSnapshots?: BranchSnapshotInfo[]
  currentBranch?: string
  currentBranchName?: string | null
  preferredWorkspacePaneTab?: WorkspacePaneTabType | null
  preferredWorkspacePaneTabByTarget?: Record<string, WorkspacePaneTabType | null>
  workspacePaneTabsByBranch?: Record<string, WorkspacePaneTabEntry[]>
  workspaceRuntimeId?: string
  status?: WorktreeStatus[]
  remote?: Partial<GitRemoteProjection>
  remoteLifecycle?: RemoteWorkspaceConnectionLifecycle | null
  workspaceProbe?: WorkspaceProbeState
}): WorkspaceState {
  const workspaceId = workspaceIdForTest(options.id)
  const branchesWithSnapshotWorktreeMetadata = options.branchSnapshots ?? options.branches ?? []
  const branches = options.branches ?? stripBranchWorktreeMetadata(branchesWithSnapshotWorktreeMetadata)
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
    remote: options.remote,
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
  seedRepoReadModelQueryData(repo, {
    branches: branchesWithSnapshotWorktreeMetadata,
    currentBranch: options.currentBranch ?? currentBranchName ?? '',
    status,
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

export function seedRepoReadModelQueryData(
  repo: Pick<WorkspaceState, 'id' | 'workspaceRuntimeId'>,
  readModel: {
    branches: BranchSnapshotInfo[]
    currentBranch: string
    status?: WorktreeStatus[]
  },
): void {
  const loadedAt = Date.now()
  const projection: GitWorkspaceRuntimeProjection = {
    snapshot: {
      branches: readModel.branches,
      current: readModel.currentBranch,
    },
    pullRequests: null,
    requested: {
      branch: null,
      pullRequestMode: 'full',
    },
    loadedAt,
  }
  setRepoProjectionQueryData(repo.id, repo.workspaceRuntimeId, null, 'full', projection)
  setRepoWorktreeStatusQueryData(repo.id, repo.workspaceRuntimeId, {
    workspaceRuntimeId: repo.workspaceRuntimeId,
    status: readModel.status ?? [],
    loadedAt,
  })
  if (readModel.currentBranch) {
    setRepoProjectionQueryData(repo.id, repo.workspaceRuntimeId, readModel.currentBranch, 'full', {
      ...projection,
      requested: {
        branch: readModel.currentBranch,
        pullRequestMode: 'full',
      },
    })
  }
}
