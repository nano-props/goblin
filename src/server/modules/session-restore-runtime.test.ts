import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'
import { createTestWorkspacePaneTabsHost } from '#/server/test-utils/workspace-pane-tabs-host.ts'
import {
  acquireWorkspaceRuntimeLease,
  clearWorkspaceRuntimesForUser,
  isCurrentWorkspaceRuntime,
  isCurrentWorkspaceRuntimeMembership,
  releaseWorkspaceRuntimeMembershipLease,
} from '#/server/modules/workspace-runtimes.ts'

const mocks = vi.hoisted(() => ({
  getServerWorkspaceState: vi.fn(),
  probeRepo: vi.fn(),
  readRepoProjection: vi.fn(),
  runRemoteLifecycleWrite: vi.fn(),
}))

const TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST = {
  commitGitCapabilityRemoval: vi.fn(async () => ({ kind: 'committed' as const })),
}

vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerWorkspaceState: mocks.getServerWorkspaceState,
  compareAndReplaceServerWorkspaceRepos: vi.fn(),
  confirmServerWorkspaceRepoEntry: vi.fn(async (entry) => ({
    matched: true,
    workspace: { openWorkspaceEntries: [entry], workspacePaneTabsByTargetByWorkspace: {} },
  })),
}))

vi.mock('#/server/modules/repo-read-paths.ts', () => ({
  probeRepo: mocks.probeRepo,
  readRepoProjection: mocks.readRepoProjection,
}))

vi.mock('#/server/modules/remote-lifecycle-write-paths.ts', () => ({
  runRemoteLifecycleWrite: mocks.runRemoteLifecycleWrite,
}))

const USER_ID = 'user_restore_runtime'
const CLIENT_ID = 'client_restore_runtime'
const REPO_ROOT = 'goblin+file:///repo'

describe('session restore runtime ownership', () => {
  beforeEach(() => {
    clearWorkspaceRuntimesForUser(USER_ID)
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local', id: REPO_ROOT }],
    })
    mocks.probeRepo.mockResolvedValue({ ok: true, root: REPO_ROOT, name: 'repo' })
    mocks.readRepoProjection.mockResolvedValue({ snapshot: null })
  })

  test('preserves the existing stub membership when lazy projection fails', async () => {
    const lease = acquireWorkspaceRuntimeLease(USER_ID, REPO_ROOT, CLIENT_ID)
    expect(isCurrentWorkspaceRuntimeMembership(USER_ID, REPO_ROOT, lease.workspaceRuntimeId, CLIENT_ID)).toBe(true)
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: USER_ID,
        clientId: CLIENT_ID,
        repoRoot: REPO_ROOT,
        workspaceRuntimeId: lease.workspaceRuntimeId,
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'error.failed-read-repo' })

    expect(isCurrentWorkspaceRuntime(USER_ID, REPO_ROOT, lease.workspaceRuntimeId)).toBe(true)
    expect(releaseWorkspaceRuntimeMembershipLease(USER_ID, CLIENT_ID, lease)).toEqual({
      released: true,
      runtimeClosed: true,
    })
  })
})
