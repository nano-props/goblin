import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { ServerWorkspaceState } from '#/shared/api-types.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import { createTestWorkspacePaneTabsHost } from '#/server/test-utils/workspace-pane-tabs-host.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const LOCAL_WORKSPACE_ID = workspaceIdForTest('goblin+file:///repo')
const NESTED_WORKSPACE_ID = workspaceIdForTest('goblin+file:///repo/src')
const OTHER_WORKSPACE_ID = workspaceIdForTest('goblin+file:///other')
const REMOTE_WORKSPACE_ID = workspaceIdForTest('goblin+ssh://prod/srv/repo')
const USER_ID = 'user-test'
const CLIENT_ID = 'client_test000000000000'
const RUNTIME_ID = 'repo-runtime-test'

const mocks = vi.hoisted(() => ({
  WorkspaceRuntimeStaleError: class WorkspaceRuntimeStaleError extends Error {
    constructor() {
      super('error.workspace-runtime-stale')
      this.name = 'WorkspaceRuntimeStaleError'
    }
  },
  acquireWorkspaceRuntimeLease: vi.fn(),
  captureWorkspaceRuntimeMembershipCapability: vi.fn(),
  releaseWorkspaceRuntimeMembershipLease: vi.fn(),
  isCurrentWorkspaceRuntimeMembership: vi.fn(),
  getServerWorkspaceState: vi.fn(),
  compareAndReplaceServerWorkspaceEntries: vi.fn(),
  confirmServerWorkspaceEntry: vi.fn(),
  probeWorkspace: vi.fn(),
  readRepoSnapshot: vi.fn(),
  runRemoteWorkspaceLifecycleWrite: vi.fn(),
  workspaceProbes: new Map<string, unknown>(),
}))

const TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST = {
  commitGitCapabilityRemoval: vi.fn(async () => ({ kind: 'committed' as const })),
}

vi.mock('#/server/modules/workspace-runtimes.ts', () => ({
  WorkspaceRuntimeStaleError: mocks.WorkspaceRuntimeStaleError,
  acquireWorkspaceRuntimeLease: mocks.acquireWorkspaceRuntimeLease,
  captureWorkspaceRuntimeMembershipCapability: mocks.captureWorkspaceRuntimeMembershipCapability,
  releaseWorkspaceRuntimeMembershipLease: mocks.releaseWorkspaceRuntimeMembershipLease,
  isCurrentWorkspaceRuntimeMembership: mocks.isCurrentWorkspaceRuntimeMembership,
  runSerializedInitialWorkspaceProbe: vi.fn(async (input) => {
    const current = mocks.workspaceProbes.get(input.workspaceId)
    if (current && (current as { status: string }).status !== 'probing') return current
    const probe = await input.probe()
    await input.beforeCommit?.({ before: { status: 'probing' }, after: probe })
    mocks.workspaceProbes.set(input.workspaceId, probe)
    return probe
  }),
  workspaceProbeStateForRuntime: vi.fn(
    (_userId, workspaceId) => mocks.workspaceProbes.get(workspaceId) ?? { status: 'probing' },
  ),
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerWorkspaceState: mocks.getServerWorkspaceState,
  compareAndReplaceServerWorkspaceEntries: mocks.compareAndReplaceServerWorkspaceEntries,
  confirmServerWorkspaceEntry: mocks.confirmServerWorkspaceEntry,
}))

vi.mock('#/server/modules/repo-read-paths.ts', () => ({
  readRepoSnapshot: mocks.readRepoSnapshot,
}))

vi.mock('#/server/modules/workspace-probe.ts', () => ({
  probeWorkspace: mocks.probeWorkspace,
}))

vi.mock('#/server/modules/remote-workspace-lifecycle-write-paths.ts', () => ({
  runRemoteWorkspaceLifecycleWrite: mocks.runRemoteWorkspaceLifecycleWrite,
}))

describe('restoreServerWorkspace', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.workspaceProbes.clear()
    mocks.acquireWorkspaceRuntimeLease.mockImplementation((_userId: string, workspaceId: string) => ({
      workspaceId,
      workspaceRuntimeId: RUNTIME_ID,
      generation: 1,
    }))
    mocks.captureWorkspaceRuntimeMembershipCapability.mockImplementation(
      (userId: string, workspaceId: string, workspaceRuntimeId: string, clientId: string) => {
        const isCurrent = () =>
          mocks.isCurrentWorkspaceRuntimeMembership(userId, workspaceId, workspaceRuntimeId, clientId)
        const assertCurrent = () => {
          if (!isCurrent()) throw new mocks.WorkspaceRuntimeStaleError()
        }
        assertCurrent()
        return { userId, clientId, workspaceId, workspaceRuntimeId, generation: 1, isCurrent, assertCurrent }
      },
    )
    mocks.isCurrentWorkspaceRuntimeMembership.mockReturnValue(true)
    mocks.probeWorkspace.mockResolvedValue(gitProbe())
    mocks.readRepoSnapshot.mockResolvedValue({
      snapshot: {
        current: 'main',
        branches: [{ name: 'main', worktree: { path: '/repo', isPrimary: false, isLocked: false } }],
        remote: {
          remotes: [],
          hasRemotes: false,
          hasBrowserRemote: false,
          remoteProviders: {},
          hasGitHubRemote: false,
        },
      },
    })
    mocks.compareAndReplaceServerWorkspaceEntries.mockImplementation(
      async (_expected: WorkspaceSessionEntry[], replacement: WorkspaceSessionEntry[]) => {
        const workspace = await mocks.getServerWorkspaceState.mock.results.at(-1)?.value
        return { matched: true, workspace: { ...workspace, openWorkspaceEntries: replacement } }
      },
    )
    mocks.confirmServerWorkspaceEntry.mockImplementation(async (entry: WorkspaceSessionEntry) => ({
      matched: true,
      workspace: { openWorkspaceEntries: [entry], workspacePaneTabsByTargetByWorkspace: {} },
    }))
    mocks.runRemoteWorkspaceLifecycleWrite.mockResolvedValue({
      kind: 'settled',
      lifecycle: { kind: 'ready' },
      workspaceProbe: gitProbe(),
      repoId: 'goblin+ssh://prod/srv/repo',
    })
  })

  test('restores server-owned workspace tabs only after strict validation succeeds', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-branch',
      workspaceId: LOCAL_WORKSPACE_ID,
      branchName: 'main',
    })
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: LOCAL_WORKSPACE_ID }],
      workspacePaneTabsByTargetByWorkspace: {
        'goblin+file:///repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost({ snapshot: { revision: 1, entries: [] } })

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: USER_ID,
      clientId: CLIENT_ID,
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('restored')
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith(
      USER_ID,
      {
        workspaceId: LOCAL_WORKSPACE_ID,
        workspaceRuntimeId: RUNTIME_ID,
        expectedWorkspaceEntry: { id: 'goblin+file:///repo' },
        targets: [{ kind: 'workspace-root' }, { kind: 'git-worktree', root: 'goblin+file:///repo' }],
      },
      expect.objectContaining({ clientId: CLIENT_ID, generation: 1 }),
    )
    expect(result.runtime).toMatchObject({
      restoredWorkspaceId: 'goblin+file:///repo',
      workspaces: [
        {
          entry: { id: 'goblin+file:///repo' },
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: RUNTIME_ID,
        },
      ],
      workspacePaneTabs: [
        {
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: RUNTIME_ID,
          snapshot: { revision: 1, entries: [] },
        },
      ],
    })
  })

  test('restores a nested directory as a plain Workspace without migrating its identity', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: NESTED_WORKSPACE_ID }],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.probeWorkspace.mockResolvedValue(plainWorkspaceProbe())
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: USER_ID,
      clientId: CLIENT_ID,
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('restored')
    expect(result.openWorkspaceEntries).toEqual(workspace.openWorkspaceEntries)
    expect(result.runtime.workspaces).toEqual([
      expect.objectContaining({
        workspaceId: 'goblin+file:///repo/src',
        repoSnapshot: null,
        workspaceProbe: expect.objectContaining({
          capabilities: expect.objectContaining({ git: { status: 'unavailable' } }),
        }),
      }),
    ])
  })

  test('validates and projects workspace tabs into a canonical snapshot', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-branch',
      workspaceId: LOCAL_WORKSPACE_ID,
      branchName: 'main',
    })
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: LOCAL_WORKSPACE_ID }],
      workspacePaneTabsByTargetByWorkspace: {
        'goblin+file:///repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost({
      snapshot: { revision: 3, entries: [] },
      repaired: true,
    })

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: USER_ID,
      clientId: CLIENT_ID,
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('repaired')
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith(
      USER_ID,
      {
        workspaceId: LOCAL_WORKSPACE_ID,
        workspaceRuntimeId: RUNTIME_ID,
        expectedWorkspaceEntry: { id: 'goblin+file:///repo' },
        targets: [{ kind: 'workspace-root' }, { kind: 'git-worktree', root: 'goblin+file:///repo' }],
      },
      expect.objectContaining({ clientId: CLIENT_ID, generation: 1 }),
    )
    expect(result.runtime.workspacePaneTabs).toEqual([
      {
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: RUNTIME_ID,
        snapshot: { revision: 3, entries: [] },
      },
    ])
  })

  test('fails directly and releases the attempt lease when the active snapshot is unavailable', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: LOCAL_WORKSPACE_ID }],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.readRepoSnapshot.mockRejectedValue(new Error('snapshot unavailable'))
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    await expect(
      restoreServerWorkspace({
        userId: USER_ID,
        clientId: CLIENT_ID,
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        workspacePaneTabsHost,
      }),
    ).rejects.toThrow('snapshot unavailable')
    expect(workspacePaneTabsHost.restoreTabs).not.toHaveBeenCalled()
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).toHaveBeenCalled()
  })

  test('keeps a local repo declaration as a stub when its path is temporarily unavailable', async () => {
    const entry = { id: LOCAL_WORKSPACE_ID }
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [entry],
    })
    mocks.probeWorkspace.mockResolvedValue({ status: 'unavailable', reason: 'error.workspace-permission-denied' })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: USER_ID,
      clientId: CLIENT_ID,
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('restored')
    expect(result.openWorkspaceEntries).toEqual([entry])
    expect(result.runtime.workspaces).toEqual([
      expect.objectContaining({
        entry,
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: RUNTIME_ID,
        repoSnapshot: null,
      }),
    ])
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('rejects a deferred workspace restore when its membership generation is superseded before success', async () => {
    const entry = { id: LOCAL_WORKSPACE_ID }
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [entry],
    })
    mocks.probeWorkspace.mockResolvedValue({ status: 'unavailable', reason: 'error.workspace-permission-denied' })
    mocks.isCurrentWorkspaceRuntimeMembership.mockReturnValueOnce(true).mockReturnValue(false)
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    await expect(
      restoreServerWorkspace({
        userId: USER_ID,
        clientId: CLIENT_ID,
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'error.workspace-runtime-stale' })

    expect(workspacePaneTabsHost.restoreTabs).not.toHaveBeenCalled()
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).toHaveBeenCalledOnce()
  })

  test('keeps an active remote repo as a stub when lifecycle is temporarily unavailable', async () => {
    const remoteEntry = { id: REMOTE_WORKSPACE_ID }
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [remoteEntry],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.runRemoteWorkspaceLifecycleWrite.mockResolvedValue({
      kind: 'settled',
      lifecycle: { kind: 'failed', attemptId: 4, reason: 'unreachable' },
      workspaceProbe: {
        status: 'unavailable',
        reason: 'error.workspace-transport-unavailable',
      },
    })
    mocks.workspaceProbes.set(remoteEntry.id, {
      status: 'unavailable',
      reason: 'error.workspace-transport-unavailable',
    })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: USER_ID,
      clientId: CLIENT_ID,
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('restored')
    expect(result.openWorkspaceEntries).toEqual(workspace.openWorkspaceEntries)
    expect(result.runtime.workspaces[0]).toMatchObject({
      workspaceId: remoteEntry.id,
      workspaceRuntimeId: RUNTIME_ID,
      repoSnapshot: null,
      workspaceProbe: { status: 'unavailable', reason: 'error.workspace-transport-unavailable' },
      transport: { kind: 'ssh', lifecycle: { kind: 'failed', attemptId: 4, reason: 'unreachable' } },
    })
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('reports a remote restore as stale when its runtime membership expires during lifecycle work', async () => {
    const remoteEntry = { id: REMOTE_WORKSPACE_ID }
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [remoteEntry],
    })
    mocks.runRemoteWorkspaceLifecycleWrite.mockResolvedValue({
      kind: 'stale-runtime',
      workspaceId: REMOTE_WORKSPACE_ID,
    })
    mocks.isCurrentWorkspaceRuntimeMembership.mockReturnValueOnce(true).mockReturnValue(false)

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    await expect(
      restoreServerWorkspace({
        userId: USER_ID,
        clientId: CLIENT_ID,
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        workspacePaneTabsHost: createTestWorkspacePaneTabsHost(),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'error.workspace-runtime-stale' })

    expect(mocks.releaseWorkspaceRuntimeMembershipLease).toHaveBeenCalledOnce()
  })

  test('releases opened runtimes when workspace tab commit fails unexpectedly', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-branch',
      workspaceId: LOCAL_WORKSPACE_ID,
      branchName: 'main',
    })
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: LOCAL_WORKSPACE_ID }],
      workspacePaneTabsByTargetByWorkspace: {
        'goblin+file:///repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    const commitError = new Error('commit failed')
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()
    workspacePaneTabsHost.restoreTabs.mockRejectedValue(commitError)

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    await expect(
      restoreServerWorkspace({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: USER_ID,
        clientId: CLIENT_ID,
        workspacePaneTabsHost,
      }),
    ).rejects.toBe(commitError)

    expect(mocks.releaseWorkspaceRuntimeMembershipLease).toHaveBeenCalledWith(USER_ID, CLIENT_ID, {
      workspaceId: LOCAL_WORKSPACE_ID,
      workspaceRuntimeId: RUNTIME_ID,
      generation: 1,
    })
  })

  test('releases opened runtimes and skips tab commits when aborted after projection restore', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-branch',
      workspaceId: LOCAL_WORKSPACE_ID,
      branchName: 'main',
    })
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: LOCAL_WORKSPACE_ID }],
      workspacePaneTabsByTargetByWorkspace: {
        'goblin+file:///repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    const controller = new AbortController()
    const abortReason = new Error('request aborted')
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.readRepoSnapshot.mockImplementation(async () => {
      controller.abort(abortReason)
      return {
        snapshot: {
          current: 'main',
          branches: [{ name: 'main', worktree: { path: '/repo', isPrimary: false, isLocked: false } }],
          remote: {
            remotes: [],
            hasRemotes: false,
            hasBrowserRemote: false,
            remoteProviders: {},
            hasGitHubRemote: false,
          },
        },
      }
    })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    await expect(
      restoreServerWorkspace({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: USER_ID,
        clientId: CLIENT_ID,
        workspacePaneTabsHost,
        signal: controller.signal,
      }),
    ).rejects.toBe(abortReason)

    expect(mocks.releaseWorkspaceRuntimeMembershipLease).toHaveBeenCalledWith(USER_ID, CLIENT_ID, {
      workspaceId: LOCAL_WORKSPACE_ID,
      workspaceRuntimeId: RUNTIME_ID,
      generation: 1,
    })
  })

  test('releases the acquired remote runtime when remote lifecycle restore is aborted', async () => {
    const remoteEntry = { id: REMOTE_WORKSPACE_ID }
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [remoteEntry],
    }
    const controller = new AbortController()
    const abortReason = new Error('remote restore aborted')
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.runRemoteWorkspaceLifecycleWrite.mockImplementation(() => new Promise(() => {}))
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const restore = restoreServerWorkspace({
      userId: USER_ID,
      clientId: CLIENT_ID,
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      workspacePaneTabsHost,
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(mocks.runRemoteWorkspaceLifecycleWrite).toHaveBeenCalled())
    controller.abort(abortReason)

    await expect(restore).rejects.toBe(abortReason)
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).toHaveBeenCalledOnce()
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).toHaveBeenCalledWith(USER_ID, CLIENT_ID, {
      workspaceId: remoteEntry.id,
      workspaceRuntimeId: RUNTIME_ID,
      generation: 1,
    })
  })

  test('uses concurrently repaired repo tabs without overwriting them', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-branch',
      workspaceId: LOCAL_WORKSPACE_ID,
      branchName: 'missing',
    })
    const otherTargetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-branch',
      workspaceId: OTHER_WORKSPACE_ID,
      branchName: 'main',
    })
    const invalidWorkspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: LOCAL_WORKSPACE_ID }],
      workspacePaneTabsByTargetByWorkspace: {
        'goblin+file:///repo': { [targetKey]: [workspacePaneStaticTabEntry('files')] },
        '/other': { [otherTargetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    const currentWorkspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: LOCAL_WORKSPACE_ID }],
    }
    mocks.getServerWorkspaceState.mockResolvedValueOnce(invalidWorkspace).mockResolvedValueOnce(currentWorkspace)
    mocks.compareAndReplaceServerWorkspaceEntries
      .mockResolvedValueOnce({ matched: true, workspace: invalidWorkspace })
      .mockResolvedValueOnce({ matched: true, workspace: currentWorkspace })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: USER_ID,
      clientId: CLIENT_ID,
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('restored')
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).not.toHaveBeenCalled()
  })
})

function gitProbe() {
  return {
    status: 'ready' as const,
    capabilities: {
      files: { read: true as const, write: true },
      terminal: { available: true },
      git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
    },
    diagnostics: [],
  }
}

function plainWorkspaceProbe() {
  return {
    ...gitProbe(),
    capabilities: { ...gitProbe().capabilities, git: { status: 'unavailable' as const } },
  }
}
