import { expect, vi } from 'vitest'
import {
  acquireWorkspaceRuntime,
  clearWorkspaceRuntimesForUser,
  listWorkspaceRuntimes,
  runRemoteWorkspaceLifecycle,
} from '#/server/modules/workspace-runtimes.ts'
import { settleWorkspaceProbeForTest } from '#/server/test-utils/workspace-runtime-capability.ts'
import { createRepoRoutes } from '#/server/routes/repo.ts'
import { testPhysicalWorktreeExecutionCapability } from '#/server/test-utils/physical-worktree-identity.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { isRemoteWorkspaceId, parseRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import type { RepoOperationsReadOptions } from '#/server/modules/repo-read-paths.ts'
import type { RepoOperationsSnapshot } from '#/shared/api-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

type ReadRepoOperationsSnapshot = (
  workspaceId: WorkspaceId,
  options?: RepoOperationsReadOptions,
) => Promise<RepoOperationsSnapshot>

export const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/repo')
export const CLIENT_ID = 'client-read-test'

const mocks = vi.hoisted(() => ({
  currentUserId: 'user-test',
  probeLocalWorkspace: vi.fn(),
  probeWorkspace: vi.fn(),
  getRepoLog: vi.fn(),
  getRepoPatch: vi.fn(),
  readRepoSnapshot: vi.fn(),
  readRepoPullRequests: vi.fn(),
  readRepoWorktreeStatus: vi.fn(),
  readRepoOperationsSnapshot: vi.fn<ReadRepoOperationsSnapshot>(),
  fetchRepo: vi.fn(),
  cloneRepo: vi.fn(),
  pullRepoBranch: vi.fn(),
  pushRepoBranch: vi.fn(),
  createRepoWorktree: vi.fn(),
  getRepoWorktreeBootstrapPreview: vi.fn(),
  deleteRepoBranch: vi.fn(),
  removeCapturedRepoWorktree: vi.fn(),
  openRepoUrl: vi.fn(),
  beginBackgroundSyncRegistration: vi.fn(),
  commitBackgroundSyncRegistration: vi.fn(),
  finishBackgroundSyncRegistration: vi.fn(),
  prepareBackgroundSync: vi.fn(),
  getBackgroundSyncRepos: vi.fn(),
  getServerFetchIntervalSec: vi.fn(),
  publishRepoReadInvalidation: vi.fn(),
  publishUserWorkspaceFilesystemInvalidation: vi.fn(),
  publishUserWorkspaceRuntimeInvalidation: vi.fn(),
  getBackgroundSyncSnapshot: vi.fn(),
  stopBackgroundSyncRuntime: vi.fn(),
}))

vi.mock('#/server/modules/background-sync.ts', () => ({
  beginBackgroundSyncRegistration: mocks.beginBackgroundSyncRegistration,
  commitBackgroundSyncRegistration: mocks.commitBackgroundSyncRegistration,
  finishBackgroundSyncRegistration: mocks.finishBackgroundSyncRegistration,
  prepareBackgroundSync: mocks.prepareBackgroundSync,
  getBackgroundSyncRepos: mocks.getBackgroundSyncRepos,
  getBackgroundSyncDiagnostics: vi.fn(),
  stopBackgroundSyncRuntime: mocks.stopBackgroundSyncRuntime,
}))
vi.mock('#/server/modules/repo-read-paths.ts', () => ({
  getRepoLog: mocks.getRepoLog,
  getRepoPatch: mocks.getRepoPatch,
  readRepoSnapshot: mocks.readRepoSnapshot,
  readRepoPullRequests: mocks.readRepoPullRequests,
  readRepoWorktreeStatus: mocks.readRepoWorktreeStatus,
  readRepoOperationsSnapshot: mocks.readRepoOperationsSnapshot,
  getRepoWorktreeBootstrapPreview: mocks.getRepoWorktreeBootstrapPreview,
}))
vi.mock('#/server/modules/workspace-probe.ts', () => ({
  probeLocalWorkspace: mocks.probeLocalWorkspace,
  probeWorkspace: mocks.probeWorkspace,
}))
vi.mock('#/server/modules/repo-write-paths.ts', () => ({
  pullRepoBranch: mocks.pullRepoBranch,
  pushRepoBranch: mocks.pushRepoBranch,
  createRepoWorktree: mocks.createRepoWorktree,
  deleteRepoBranch: mocks.deleteRepoBranch,
  removeCapturedRepoWorktree: mocks.removeCapturedRepoWorktree,
  fetchRepo: mocks.fetchRepo,
  openRepoUrl: mocks.openRepoUrl,
}))
vi.mock('#/server/modules/repo-clone-write.ts', () => ({
  cloneRepo: mocks.cloneRepo,
}))
vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerFetchIntervalSec: mocks.getServerFetchIntervalSec,
}))
vi.mock('#/server/modules/invalidation-broker.ts', () => ({
  publishRepoReadInvalidation: mocks.publishRepoReadInvalidation,
  publishUserWorkspaceFilesystemInvalidation: mocks.publishUserWorkspaceFilesystemInvalidation,
  publishUserWorkspaceRuntimeInvalidation: mocks.publishUserWorkspaceRuntimeInvalidation,
}))
vi.mock('#/server/modules/repo-source.ts', () => ({
  resolveRepoSource: vi.fn(async () => ({ getSnapshot: mocks.getBackgroundSyncSnapshot })),
}))
vi.mock('#/server/common/identity.ts', () => ({
  userIdFromContext: () => mocks.currentUserId,
}))

export function resetRepoRouteHarness() {
  vi.clearAllMocks()
  mocks.currentUserId = 'user-test'
  clearWorkspaceRuntimesForUser('user-test')
  clearWorkspaceRuntimesForUser('user-other')
  mocks.probeLocalWorkspace.mockResolvedValue({
    status: 'ready',
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git: { status: 'unavailable' },
    },
    diagnostics: [],
  })
  mocks.beginBackgroundSyncRegistration.mockImplementation((userId, clientId, revision, targets) => {
    const controller = new AbortController()
    return { userId, clientId, revision, targets, signal: controller.signal }
  })
  mocks.commitBackgroundSyncRegistration.mockReturnValue(true)
  mocks.probeWorkspace.mockImplementation(mocks.probeLocalWorkspace)
  mocks.pullRepoBranch.mockResolvedValue({ ok: true, message: '' })
  mocks.getBackgroundSyncSnapshot.mockResolvedValue({ remote: { hasRemotes: true } })
}

export function setRepoRouteTestUserId(userId: string): void {
  mocks.currentUserId = userId
}

export function createTestRepoRoutes(
  worktreeRemovalApplication: Parameters<typeof createRepoRoutes>[0]['worktreeRemovalApplication'] = {
    async removeWorktree(_userId, input) {
      return await input.remove(
        testPhysicalWorktreeExecutionCapability('/repo/worktree'),
        {
          beforeRemove: async () => ({ ok: true, message: '' }),
          afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
        },
        new AbortController().signal,
      )
    },
  },
  workspaceCapabilityTransitionHost: Parameters<typeof createRepoRoutes>[0]['workspaceCapabilityTransitionHost'] = {
    commitGitCapabilityRemoval: vi.fn(async () => ({ kind: 'committed' as const })),
  },
) {
  return createRepoRoutes({
    worktreeRemovalApplication,
    workspaceCapabilityTransitionHost,
  })
}

export async function openTestWorkspaceRuntime(repoRoot = WORKSPACE_ID): Promise<string> {
  const workspaceRuntimeId = acquireWorkspaceRuntime('user-test', repoRoot, CLIENT_ID)
  if (isRemoteWorkspaceId(repoRoot)) {
    const remote = parseRemoteWorkspaceId(repoRoot)
    if (!remote) throw new Error('expected remote workspace id')
    await runRemoteWorkspaceLifecycle('user-test', repoRoot, workspaceRuntimeId, async () => ({
      kind: 'ready',
      gitAvailable: true,
      lifecycle: {
        kind: 'ready',
        target: {
          id: repoRoot,
          alias: remote.alias,
          host: 'example.test',
          user: 'developer',
          port: 22,
          remotePath: remote.remotePath,
          displayName: `${remote.alias}:${remote.remotePath}`,
        },
      },
    }))
  }
  await settleWorkspaceProbeForTest(
    {
      userId: 'user-test',
      workspaceId: repoRoot,
      workspaceRuntimeId,
    },
    {
      status: 'ready',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
      },
      diagnostics: [],
    },
  )
  return workspaceRuntimeId
}

export function expectRemoteRuntimeFailed(repoId: string, workspaceRuntimeId: string): void {
  expect(listWorkspaceRuntimes('user-test')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        workspaceId: repoId,
        workspaceRuntimeId,
        remoteLifecycle: expect.objectContaining({ kind: 'failed', reason: 'unreachable' }),
      }),
    ]),
  )
}

export function repoRouteMocks() {
  return mocks
}
