import { afterEach, beforeEach, expect, vi } from 'vitest'
import type { PullRequestInfo } from '#/shared/git-types.ts'
import type { RepoSnapshot } from '#/shared/api-types.ts'
import { normalizeRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { RepoWorktreeRemovalLifecycle } from '#/server/modules/repo-worktree-removal-lifecycle.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type * as RepoWritePaths from '#/server/modules/repo-write-paths.ts'

// No library fixture spans Git, SSH, settings, invalidation, and write-coordination boundaries.
// Keep those module mocks shared while each suite owns one observable repository behavior.
export const REPO_ID = workspaceIdForTest('goblin+file:///tmp/repo')
export const LINKED_REPO_ID = workspaceIdForTest('goblin+file:///tmp/repo-linked')
export const WORKTREE_REPO_ID = workspaceIdForTest('goblin+file:///tmp/repo-worktree')
export const WORKTREE_BOOTSTRAP_CONFIG_HASH = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

export const successfulRemovalLifecycle = {
  beforeRemove: async () => ({ ok: true as const, message: '' }),
  afterWorktreeRemoved: async () => ({ ok: true as const, message: '' }),
}

async function physicalWorktreeCapabilityForTest(workspaceId: WorkspaceId, worktreePath: string) {
  const { issuePhysicalWorktreeExecutionCapability } =
    await import('#/server/worktree-removal/physical-worktree-capability.ts')
  const canonicalWorktreePath = worktreePath
  return issuePhysicalWorktreeExecutionCapability(
    { kind: 'local', executionNamespaceId: 'local', endpoint: canonicalWorktreePath },
    {
      userId: 'test-user',
      workspaceId,
      workspaceRuntimeId: 'test-runtime',
      worktreePath: canonicalWorktreePath,
      execution: {
        kind: 'local',
        canonicalWorktreePath,
      },
      runtimeSignal: new AbortController().signal,
    },
  )
}

export async function removeRepoWorktreeForTest(
  cwd: WorkspaceId,
  input: {
    branch: string
    worktreePath: string
    deleteBranch: boolean
    forceDeleteBranch?: boolean
    deleteUpstream?: boolean
  },
  lifecycle: RepoWorktreeRemovalLifecycle,
  signal?: AbortSignal,
) {
  const [{ removeCapturedRepoWorktree }, physicalWorktreeCapability] = await Promise.all([
    import('#/server/modules/repo-write-paths.ts'),
    physicalWorktreeCapabilityForTest(cwd, input.worktreePath),
  ])
  return await removeCapturedRepoWorktree(cwd, input, lifecycle, physicalWorktreeCapability, signal)
}

export function removeLocalRepoWorktreeForTest(
  options: {
    deleteBranch: boolean
    forceDeleteBranch?: boolean
    deleteUpstream?: boolean
  },
  lifecycle: RepoWorktreeRemovalLifecycle,
  signal?: AbortSignal,
) {
  return removeRepoWorktreeForTest(
    REPO_ID,
    { branch: 'feature/a', worktreePath: '/tmp/repo-worktree', ...options },
    lifecycle,
    signal,
  )
}

export function createLocalRepoWorktreeWithBootstrap(
  createRepoWorktree: typeof RepoWritePaths.createRepoWorktree,
  options: { configTrusted: boolean },
) {
  return createRepoWorktree(
    REPO_ID,
    {
      worktreePath: '/tmp/repo-worktree',
      mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
    },
    undefined,
    {
      worktreeBootstrap: {
        kind: 'run',
        configHash: WORKTREE_BOOTSTRAP_CONFIG_HASH,
        configTrusted: options.configTrusted,
      },
    },
  )
}

const hoistedMocks = vi.hoisted(() => ({
  checkGitAvailable: vi.fn(),
  createWorktree: vi.fn(),
  deleteBranch: vi.fn(),
  deleteUpstreamBranch: vi.fn(),
  fsAccess: vi.fn(),
  fsMkdir: vi.fn(),
  fsRealpath: vi.fn(),
  fsStat: vi.fn(),
  isGitRepo: vi.fn(),
  getBranches: vi.fn(),
  getBranchWorktreeIdentities: vi.fn(),
  getBranchPullRequests: vi.fn(),
  getCurrentBranch: vi.fn(),
  getHeadHash: vi.fn(),
  getDefaultBranch: vi.fn(),
  resolveRepoCommonDir: vi.fn(),
  resolveRepoObjectsDir: vi.fn(),
  getRepoName: vi.fn(),
  getRepoRoot: vi.fn(),
  getRemoteInfo: vi.fn(),
  getWorkingStatus: vi.fn(),
  getUpstream: vi.fn(),
  readWorktreeMembership: vi.fn(),
  sampleWorktreeStatusForTarget: vi.fn(),
  isAncestor: vi.fn(),
  fetchAll: vi.fn(),
  cloneGitRepo: vi.fn(),
  pullBranch: vi.fn(),
  pushBranch: vi.fn(),
  removeWorktree: vi.fn(),
  publishRepoQueryInvalidation: vi.fn(),
  publishSettingsInvalidation: vi.fn(),
  bootstrapWorktreeAfterCreate: vi.fn(),
  bootstrapRemoteWorktreeAfterCreate: vi.fn(),
  createRemoteWorktree: vi.fn(),
  deleteRemoteBranch: vi.fn(),
  fetchRemoteRepo: vi.fn(),
  getWorktreeBootstrapPreview: vi.fn(),
  getRemoteRepoWorktreePaths: vi.fn(),
  getRemoteSnapshot: vi.fn(),
  getRemoteWorkspacePaneTargetIdentities: vi.fn(),
  resolveRemoteRepoCommonDir: vi.fn(),
  getRemoteWorktreeBootstrapPreview: vi.fn(),
  removeRemoteWorktree: vi.fn(),
  getServerWorkspaceSettings: vi.fn(),
  getServerFetchIntervalSec: vi.fn(),
  subscribeServerFetchInterval: vi.fn(),
  pruneServerWorkspaceSettingsForRemovedWorktree: vi.fn(),
  resolveRemoteTarget: vi.fn(),
  trustServerWorkspaceWorktreeBootstrapConfig: vi.fn(),
  untrustServerWorkspaceWorktreeBootstrapConfig: vi.fn(),
}))

vi.mock('#/system/git/branches.ts', () => ({
  deleteBranch: hoistedMocks.deleteBranch,
  deleteUpstreamBranch: hoistedMocks.deleteUpstreamBranch,
  getBranches: hoistedMocks.getBranches,
  getBranchWorktreeIdentities: hoistedMocks.getBranchWorktreeIdentities,
  getCurrentBranch: hoistedMocks.getCurrentBranch,
  getHeadHash: hoistedMocks.getHeadHash,
  getDefaultBranch: hoistedMocks.getDefaultBranch,
  resolveRepoCommonDir: hoistedMocks.resolveRepoCommonDir,
  resolveRepoObjectsDir: hoistedMocks.resolveRepoObjectsDir,
  getRepoName: hoistedMocks.getRepoName,
  getRepoRoot: hoistedMocks.getRepoRoot,
  getUpstream: hoistedMocks.getUpstream,
  isAncestor: hoistedMocks.isAncestor,
  isGitRepo: hoistedMocks.isGitRepo,
}))

vi.mock('#/system/git/git-exec.ts', () => ({
  checkGitAvailable: hoistedMocks.checkGitAvailable,
}))

vi.mock('#/system/git/clone.ts', () => ({
  cloneRepo: hoistedMocks.cloneGitRepo,
}))

vi.mock('node:fs', () => ({
  promises: {
    access: hoistedMocks.fsAccess,
    mkdir: hoistedMocks.fsMkdir,
    realpath: hoistedMocks.fsRealpath,
    stat: hoistedMocks.fsStat,
  },
  constants: {
    R_OK: 4,
    W_OK: 2,
  },
}))

vi.mock('#/system/git/remote.ts', () => ({
  fetchAll: hoistedMocks.fetchAll,
  getRemoteInfo: hoistedMocks.getRemoteInfo,
  pullBranch: hoistedMocks.pullBranch,
  pushBranch: hoistedMocks.pushBranch,
}))

vi.mock('#/system/git/remote-refs.ts', () => ({
  getRemoteTrackingBranches: vi.fn(async () => [
    { ref: 'refs/remotes/origin/main', remote: 'origin', branch: 'main' },
    { ref: 'refs/remotes/origin/feature/a', remote: 'origin', branch: 'feature/a' },
  ]),
}))

vi.mock('#/system/git/status.ts', () => ({
  getWorkingStatus: hoistedMocks.getWorkingStatus,
  sampleWorktreeStatusForTarget: hoistedMocks.sampleWorktreeStatusForTarget,
}))

vi.mock('#/system/git/worktrees.ts', () => ({
  createWorktree: hoistedMocks.createWorktree,
  readWorktreeMembership: hoistedMocks.readWorktreeMembership,
  removeWorktree: hoistedMocks.removeWorktree,
}))

vi.mock('#/system/git/worktree-bootstrap.ts', () => ({
  bootstrapWorktreeAfterCreate: hoistedMocks.bootstrapWorktreeAfterCreate,
  getWorktreeBootstrapPreview: hoistedMocks.getWorktreeBootstrapPreview,
}))

vi.mock('#/shared/input-validation.ts', () => ({
  isValidCwd: () => true,
  isValidWorkspaceLocatorInput: () => true,
  toSafeWorkspaceLocator: (value: unknown) => (typeof value === 'string' ? value : null),
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerWorkspaceSettings: hoistedMocks.getServerWorkspaceSettings,
  getServerFetchIntervalSec: hoistedMocks.getServerFetchIntervalSec,
  subscribeServerFetchInterval: hoistedMocks.subscribeServerFetchInterval,
  pruneServerWorkspaceSettingsForRemovedWorktree: hoistedMocks.pruneServerWorkspaceSettingsForRemovedWorktree,
  trustServerWorkspaceWorktreeBootstrapConfig: hoistedMocks.trustServerWorkspaceWorktreeBootstrapConfig,
  untrustServerWorkspaceWorktreeBootstrapConfig: hoistedMocks.untrustServerWorkspaceWorktreeBootstrapConfig,
}))

vi.mock('#/system/ssh/config.ts', () => ({
  resolveRemoteTarget: hoistedMocks.resolveRemoteTarget,
}))

vi.mock('#/system/ssh/diagnostics.ts', () => ({
  testRemoteWorkspace: vi.fn(),
}))

vi.mock('#/system/ssh/git.ts', () => ({
  bootstrapRemoteWorktreeAfterCreate: hoistedMocks.bootstrapRemoteWorktreeAfterCreate,
  createRemoteWorktree: hoistedMocks.createRemoteWorktree,
  deleteRemoteBranch: hoistedMocks.deleteRemoteBranch,
  fetchRemoteRepo: hoistedMocks.fetchRemoteRepo,
  getRemoteBrowserUrl: vi.fn(),
  getRemoteLog: vi.fn(),
  getRemotePatch: vi.fn(),
  getRemoteRepoWorktreePaths: hoistedMocks.getRemoteRepoWorktreePaths,
  getRemoteWorkspacePaneTargetIdentities: hoistedMocks.getRemoteWorkspacePaneTargetIdentities,
  resolveRemoteRepoCommonDir: hoistedMocks.resolveRemoteRepoCommonDir,
  getRemoteSnapshot: hoistedMocks.getRemoteSnapshot,
  getRemoteStatus: vi.fn(),
  getRemoteTrackingBranches: vi.fn(),
  getRemoteWorktreeBootstrapPreview: hoistedMocks.getRemoteWorktreeBootstrapPreview,
  pullRemoteBranch: vi.fn(),
  pushRemoteBranch: vi.fn(),
  removeRemoteWorktree: hoistedMocks.removeRemoteWorktree,
}))

vi.mock('#/system/git/pull-requests.ts', () => ({
  getBranchPullRequests: hoistedMocks.getBranchPullRequests,
}))

vi.mock('#/server/modules/invalidation-broker.ts', () => ({
  publishRepoQueryInvalidation: hoistedMocks.publishRepoQueryInvalidation,
  publishSettingsInvalidation: hoistedMocks.publishSettingsInvalidation,
}))

export const mocks = hoistedMocks

beforeEach(async () => {
  const { resetRepoServerOperationRegistryForTests } = await import('#/server/modules/repo-operation-registry.ts')
  const { resetRepoWriteOperationCoordinatorForTests } =
    await import('#/server/modules/repo-write-operation-coordinator.ts')
  resetRepoServerOperationRegistryForTests()
  resetRepoWriteOperationCoordinatorForTests()
  vi.clearAllMocks()
  hoistedMocks.checkGitAvailable.mockResolvedValue({ ok: true, message: '' })
  hoistedMocks.fsStat.mockResolvedValue({ isDirectory: () => true, dev: 1n, ino: 1n })
  hoistedMocks.fsAccess.mockResolvedValue(undefined)
  hoistedMocks.fsMkdir.mockResolvedValue(undefined)
  hoistedMocks.fsRealpath.mockImplementation(async (cwd: string) => cwd)
  hoistedMocks.isGitRepo.mockResolvedValue(true)
  hoistedMocks.pullBranch.mockResolvedValue({ ok: true, message: 'ok' })
  hoistedMocks.pushBranch.mockResolvedValue({ ok: true, message: 'ok' })
  hoistedMocks.cloneGitRepo.mockResolvedValue({ ok: true, message: 'ok', path: '/tmp/repo' })
  hoistedMocks.createWorktree.mockResolvedValue({ ok: true, message: 'ok' })
  hoistedMocks.createRemoteWorktree.mockResolvedValue({ ok: true, message: 'ok' })
  hoistedMocks.bootstrapWorktreeAfterCreate.mockResolvedValue({ ok: true, message: '' })
  hoistedMocks.bootstrapRemoteWorktreeAfterCreate.mockResolvedValue({ ok: true, message: '' })
  hoistedMocks.getWorktreeBootstrapPreview.mockResolvedValue({
    ok: true,
    preview: {
      hasConfig: false,
      hasOperations: false,
      configHash: null,
      copyCount: 0,
      symlinkCount: 0,
      hardlinkCount: 0,
      excludeCount: 0,
    },
  })
  hoistedMocks.getRemoteWorktreeBootstrapPreview.mockResolvedValue({
    ok: true,
    preview: {
      hasConfig: false,
      hasOperations: false,
      configHash: null,
      copyCount: 0,
      symlinkCount: 0,
      hardlinkCount: 0,
      excludeCount: 0,
    },
  })
  hoistedMocks.getServerWorkspaceSettings.mockResolvedValue([])
  hoistedMocks.getServerFetchIntervalSec.mockResolvedValue(5)
  hoistedMocks.subscribeServerFetchInterval.mockImplementation(() => () => {})
  hoistedMocks.pruneServerWorkspaceSettingsForRemovedWorktree.mockResolvedValue(false)
  hoistedMocks.resolveRemoteTarget.mockResolvedValue({
    target: {
      id: normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' }),
      alias: 'prod',
      host: 'example.test',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
    },
  })
  hoistedMocks.trustServerWorkspaceWorktreeBootstrapConfig.mockResolvedValue([])
  hoistedMocks.untrustServerWorkspaceWorktreeBootstrapConfig.mockResolvedValue(true)
  hoistedMocks.deleteBranch.mockResolvedValue({ ok: true, message: 'ok' })
  hoistedMocks.deleteUpstreamBranch.mockResolvedValue({ ok: true, message: 'ok' })
  hoistedMocks.removeWorktree.mockResolvedValue({ ok: true, message: 'ok' })
  hoistedMocks.deleteRemoteBranch.mockResolvedValue({ ok: true, message: 'ok' })
  hoistedMocks.removeRemoteWorktree.mockResolvedValue({ ok: true, message: 'ok' })
  hoistedMocks.fetchRemoteRepo.mockResolvedValue({ ok: true, message: 'fetched' })
  hoistedMocks.getRemoteRepoWorktreePaths.mockResolvedValue([])
  hoistedMocks.resolveRemoteRepoCommonDir.mockImplementation(
    async (target: { remotePath: string }) => target.remotePath,
  )
  hoistedMocks.getCurrentBranch.mockResolvedValue('main')
  hoistedMocks.resolveRepoCommonDir.mockImplementation(async (cwd: string) =>
    cwd.startsWith('/tmp/repo') ? '/tmp/repo/.git' : `${cwd}/.git`,
  )
  hoistedMocks.resolveRepoObjectsDir.mockImplementation(async (cwd: string) =>
    cwd.startsWith('/tmp/repo') ? '/tmp/repo/.git/objects' : `${cwd}/.git/objects`,
  )
  hoistedMocks.getRepoName.mockResolvedValue('repo')
  hoistedMocks.getRepoRoot.mockResolvedValue('/tmp/repo')
  hoistedMocks.readWorktreeMembership.mockResolvedValue([])
  hoistedMocks.sampleWorktreeStatusForTarget.mockImplementation(async (worktree) => ({
    kind: worktree.isBare ? 'bare' : 'status',
    worktree,
    ...(worktree.isBare ? {} : { entries: [] }),
  }))
  hoistedMocks.getDefaultBranch.mockResolvedValue('main')
  hoistedMocks.getUpstream.mockResolvedValue(null)
  hoistedMocks.isAncestor.mockResolvedValue(true)
})

afterEach(() => {
  vi.resetModules()
})

export function repoSnapshot(branch = 'main'): RepoSnapshot {
  return {
    branches: [
      {
        name: branch,
        isCurrent: true,
        ahead: 0,
        behind: 0,
        lastCommitHash: 'hash-000000000000000000000000000000000000',
        lastCommitShortHash: 'hash-0',
        lastCommitMessage: 'commit 0',
        lastCommitDate: '2024-01-01T00:00:00.000Z',
        lastCommitAuthor: 'dev',
      },
    ],
    current: branch,
  }
}

export function pullRequest(number: number): PullRequestInfo {
  return {
    number,
    title: `PR ${number}`,
    url: `https://example.com/pr/${number}`,
    state: 'open',
  }
}

type TestRepoQueryInvalidation = {
  repoId: string
  query: 'repo-snapshot' | 'repo-worktree-snapshot' | 'repo-runtime'
}
type TestRepoSnapshotInvalidation = { repoId: string; query: 'repo-snapshot' }
type TestRepoWorktreeSnapshotInvalidation = { repoId: string; query: 'repo-worktree-snapshot' }

function repoQueryInvalidationEvents(): TestRepoQueryInvalidation[] {
  return hoistedMocks.publishRepoQueryInvalidation.mock.calls.map(([event]) => event as TestRepoQueryInvalidation)
}

export function repoSnapshotInvalidations(): TestRepoSnapshotInvalidation[] {
  return repoQueryInvalidationEvents().filter(
    (event): event is TestRepoSnapshotInvalidation => event.query === 'repo-snapshot',
  )
}

export function repoWorktreeSnapshotInvalidations(): TestRepoWorktreeSnapshotInvalidation[] {
  return repoQueryInvalidationEvents().filter(
    (event): event is TestRepoWorktreeSnapshotInvalidation => event.query === 'repo-worktree-snapshot',
  )
}

export function expectRepoSnapshotInvalidations(...events: TestRepoSnapshotInvalidation[]): void {
  expect(repoSnapshotInvalidations()).toEqual(events)
}

export function expectNoRepoSnapshotInvalidations(): void {
  expectRepoSnapshotInvalidations()
}
