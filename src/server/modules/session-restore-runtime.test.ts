import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultWorkspaceSessionState } from '#/shared/settings-defaults.ts'
import {
  acquireRepoRuntimeLease,
  clearRepoRuntimesForUser,
  isCurrentRepoRuntimeMembership,
  releaseRepoRuntimeMembershipLease,
} from '#/server/modules/repo-runtimes.ts'

const mocks = vi.hoisted(() => ({
  getServerSessionState: vi.fn(),
  probeRepo: vi.fn(),
  readRepoProjection: vi.fn(),
  runRemoteLifecycleWrite: vi.fn(),
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerSessionState: mocks.getServerSessionState,
  saveRebuiltServerSessionState: vi.fn(),
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
const REPO_ROOT = '/repo'

describe('session restore runtime ownership', () => {
  beforeEach(() => {
    clearRepoRuntimesForUser(USER_ID)
    mocks.getServerSessionState.mockResolvedValue({
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: REPO_ROOT }],
      restoredRepoId: REPO_ROOT,
    })
    mocks.probeRepo.mockResolvedValue({ ok: true, root: REPO_ROOT, name: 'repo' })
    mocks.readRepoProjection.mockResolvedValue({ snapshot: null })
  })

  test('preserves the existing stub membership when lazy projection fails', async () => {
    const lease = acquireRepoRuntimeLease(USER_ID, REPO_ROOT, CLIENT_ID)
    const workspacePaneTabsHost = {
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(),
      updateTabs: vi.fn(),
    }

    const { restoreRepoTabsForRepo } = await import('#/server/modules/session-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        userId: USER_ID,
        clientId: CLIENT_ID,
        repoRoot: REPO_ROOT,
        repoRuntimeId: lease.repoRuntimeId,
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'error.failed-read-repo' })

    expect(isCurrentRepoRuntimeMembership(USER_ID, REPO_ROOT, lease.repoRuntimeId, CLIENT_ID)).toBe(true)
    expect(releaseRepoRuntimeMembershipLease(USER_ID, CLIENT_ID, lease)).toEqual({
      released: true,
      runtimeClosed: true,
    })
  })
})
