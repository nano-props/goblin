import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'
import { createTestWorkspacePaneTabsHost } from '#/server/test-utils/workspace-pane-tabs-host.ts'
import {
  acquireRepoRuntimeLease,
  clearRepoRuntimesForUser,
  isCurrentRepoRuntime,
  isCurrentRepoRuntimeMembership,
  releaseRepoRuntimeMembershipLease,
} from '#/server/modules/repo-runtimes.ts'

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
    clearRepoRuntimesForUser(USER_ID)
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local', id: REPO_ROOT }],
    })
    mocks.probeRepo.mockResolvedValue({ ok: true, root: REPO_ROOT, name: 'repo' })
    mocks.readRepoProjection.mockResolvedValue({ snapshot: null })
  })

  test('preserves the existing stub membership when lazy projection fails', async () => {
    const lease = acquireRepoRuntimeLease(USER_ID, REPO_ROOT, CLIENT_ID)
    expect(isCurrentRepoRuntimeMembership(USER_ID, REPO_ROOT, lease.repoRuntimeId, CLIENT_ID)).toBe(true)
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: USER_ID,
        clientId: CLIENT_ID,
        repoRoot: REPO_ROOT,
        repoRuntimeId: lease.repoRuntimeId,
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'error.failed-read-repo' })

    expect(isCurrentRepoRuntime(USER_ID, REPO_ROOT, lease.repoRuntimeId)).toBe(true)
    expect(releaseRepoRuntimeMembershipLease(USER_ID, CLIENT_ID, lease)).toEqual({
      released: true,
      runtimeClosed: true,
    })
  })
})
