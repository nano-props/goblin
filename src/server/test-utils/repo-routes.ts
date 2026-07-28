import { expect, vi } from 'vitest'
import {
  acquireWorkspaceRuntime,
  clearWorkspaceRuntimesForUser,
  commitWorkspaceProbeState,
  listWorkspaceRuntimes,
} from '#/server/modules/workspace-runtimes.ts'
import { createRepoRoutes } from '#/server/routes/repo.ts'
import { testPhysicalWorktreeExecutionCapability } from '#/server/test-utils/physical-worktree-identity.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

export const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/repo')
export const CLIENT_ID = 'client-read-test'

const mocks = vi.hoisted(() => ({
  probeLocalWorkspace: vi.fn(),
  probeWorkspace: vi.fn(),
  getRepoLog: vi.fn(),
  getRepoPatch: vi.fn(),
  readRepoSnapshot: vi.fn(),
  readRepoPullRequests: vi.fn(),
  readRepoWorktreeStatus: vi.fn(),
  readRepoOperationsSnapshot: vi.fn(),
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
}))

vi.mock('#/server/modules/background-sync.ts', () => ({
  beginBackgroundSyncRegistration: mocks.beginBackgroundSyncRegistration,
  commitBackgroundSyncRegistration: mocks.commitBackgroundSyncRegistration,
  finishBackgroundSyncRegistration: mocks.finishBackgroundSyncRegistration,
  prepareBackgroundSync: mocks.prepareBackgroundSync,
  getBackgroundSyncRepos: mocks.getBackgroundSyncRepos,
  getBackgroundSyncDiagnostics: vi.fn(),
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
  cloneRepo: mocks.cloneRepo,
  pullRepoBranch: mocks.pullRepoBranch,
  pushRepoBranch: mocks.pushRepoBranch,
  createRepoWorktree: mocks.createRepoWorktree,
  deleteRepoBranch: mocks.deleteRepoBranch,
  removeCapturedRepoWorktree: mocks.removeCapturedRepoWorktree,
  fetchRepo: mocks.fetchRepo,
  openRepoUrl: mocks.openRepoUrl,
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
  userIdFromContext: () => 'user-test',
}))

export function resetRepoRouteHarness() {
  vi.clearAllMocks()
  clearWorkspaceRuntimesForUser('user-test')
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
  repoMutationApplication: Parameters<typeof createRepoRoutes>[0]['repoMutationApplication'] = {
    deleteBranch: async (_userId, input) => await input.deleteBranch(),
  },
  workspaceCapabilityTransitionHost: Parameters<typeof createRepoRoutes>[0]['workspaceCapabilityTransitionHost'] = {
    commitGitCapabilityRemoval: vi.fn(async () => ({ kind: 'committed' as const })),
  },
) {
  return createRepoRoutes({
    worktreeRemovalApplication,
    repoMutationApplication,
    workspaceCapabilityTransitionHost,
  })
}

export async function openTestWorkspaceRuntime(repoRoot = WORKSPACE_ID): Promise<string> {
  const workspaceRuntimeId = acquireWorkspaceRuntime('user-test', repoRoot, CLIENT_ID)
  commitWorkspaceProbeState({
    userId: 'user-test',
    workspaceId: repoRoot,
    workspaceRuntimeId,
    probe: {
      status: 'ready',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
      },
      diagnostics: [],
    },
  })
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
