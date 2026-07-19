import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'
import { createTestWorkspacePaneTabsHost } from '#/server/test-utils/workspace-pane-tabs-host.ts'
import {
  acquireWorkspaceRuntimeLease,
  clearWorkspaceRuntimesForUser,
  commitWorkspaceProbeState,
  isCurrentWorkspaceRuntime,
  isCurrentWorkspaceRuntimeMembership,
  releaseWorkspaceRuntimeMembershipLease,
} from '#/server/modules/workspace-runtimes.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const mocks = vi.hoisted(() => ({
  getServerWorkspaceState: vi.fn(),
  readRepoProjection: vi.fn(),
  runRemoteWorkspaceLifecycleWrite: vi.fn(),
}))

const TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST = {
  commitGitCapabilityRemoval: vi.fn(async () => ({ kind: 'committed' as const })),
}

vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerWorkspaceState: mocks.getServerWorkspaceState,
  compareAndReplaceServerWorkspaceEntries: vi.fn(),
  confirmServerWorkspaceEntry: vi.fn(async (entry) => ({
    matched: true,
    workspace: { openWorkspaceEntries: [entry], workspacePaneTabsByTargetByWorkspace: {} },
  })),
}))

vi.mock('#/server/modules/repo-read-paths.ts', () => ({
  readRepoProjection: mocks.readRepoProjection,
}))

vi.mock('#/server/modules/remote-workspace-lifecycle-write-paths.ts', () => ({
  runRemoteWorkspaceLifecycleWrite: mocks.runRemoteWorkspaceLifecycleWrite,
}))

const USER_ID = 'user_restore_runtime'
const CLIENT_ID = 'client_restore_runtime'
const REPO_ROOT = workspaceIdForTest('goblin+file:///repo')

describe('session restore runtime ownership', () => {
  beforeEach(() => {
    clearWorkspaceRuntimesForUser(USER_ID)
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local', id: REPO_ROOT }],
    })
    mocks.readRepoProjection.mockResolvedValue({ snapshot: null })
  })

  test('preserves the existing stub membership when lazy projection is deferred', async () => {
    const lease = acquireWorkspaceRuntimeLease(USER_ID, REPO_ROOT, CLIENT_ID)
    commitWorkspaceProbeState({
      userId: USER_ID,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: lease.workspaceRuntimeId,
      probe: {
        status: 'ready',
        name: 'workspace',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
        },
        diagnostics: [],
      },
    })
    expect(isCurrentWorkspaceRuntimeMembership(USER_ID, REPO_ROOT, lease.workspaceRuntimeId, CLIENT_ID)).toBe(true)
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreWorkspaceTabs } = await import('#/server/modules/workspace-tabs-restore.ts')
    const result = await restoreWorkspaceTabs({
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      userId: USER_ID,
      clientId: CLIENT_ID,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: lease.workspaceRuntimeId,
      workspacePaneTabsHost,
    })

    expect(result.workspace).toMatchObject({ workspaceId: REPO_ROOT, projection: null })
    expect(result.snapshot).toBeNull()
    expect(workspacePaneTabsHost.restoreTabs).not.toHaveBeenCalled()
    expect(isCurrentWorkspaceRuntime(USER_ID, REPO_ROOT, lease.workspaceRuntimeId)).toBe(true)
    expect(releaseWorkspaceRuntimeMembershipLease(USER_ID, CLIENT_ID, lease)).toEqual({
      released: true,
      runtimeClosed: true,
    })
  })
})
