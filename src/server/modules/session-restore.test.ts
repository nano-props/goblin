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

const mocks = vi.hoisted(() => ({
  acquireWorkspaceRuntimeLease: vi.fn(),
  releaseWorkspaceRuntimeMembershipLease: vi.fn(),
  isCurrentWorkspaceRuntimeMembership: vi.fn(),
  getServerWorkspaceState: vi.fn(),
  compareAndReplaceServerWorkspaceEntries: vi.fn(),
  confirmServerWorkspaceEntry: vi.fn(),
  probeWorkspace: vi.fn(),
  readRepoProjection: vi.fn(),
  runRemoteWorkspaceLifecycleWrite: vi.fn(),
  workspaceProbes: new Map<string, unknown>(),
}))

const TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST = {
  commitGitCapabilityRemoval: vi.fn(async () => ({ kind: 'committed' as const })),
}

vi.mock('#/server/modules/workspace-runtimes.ts', () => ({
  acquireWorkspaceRuntimeLease: mocks.acquireWorkspaceRuntimeLease,
  releaseWorkspaceRuntimeMembershipLease: mocks.releaseWorkspaceRuntimeMembershipLease,
  isCurrentWorkspaceRuntimeMembership: mocks.isCurrentWorkspaceRuntimeMembership,
  commitWorkspaceProbeState: vi.fn((input) => {
    mocks.workspaceProbes.set(input.workspaceId, input.probe)
    return true
  }),
  commitOrReadInitialWorkspaceProbeState: vi.fn((input) => {
    const current = mocks.workspaceProbes.get(input.workspaceId)
    if (current) return current
    mocks.workspaceProbes.set(input.workspaceId, input.probe)
    return input.probe
  }),
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
  readRepoProjection: mocks.readRepoProjection,
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
      workspaceRuntimeId: 'repo-runtime-test',
      generation: 1,
    }))
    mocks.isCurrentWorkspaceRuntimeMembership.mockReturnValue(true)
    mocks.probeWorkspace.mockResolvedValue(gitProbe())
    mocks.readRepoProjection.mockResolvedValue({
      snapshot: { current: 'main', branches: [{ name: 'main', worktree: { path: '/repo' } }] },
      status: [],
      pullRequests: null,
      operations: { operations: [], loadedAt: 0 },
      requested: { branch: null, pullRequestMode: 'full' },
      loadedAt: 1,
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
      name: 'repo',
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
      openWorkspaceEntries: [{ kind: 'local', id: LOCAL_WORKSPACE_ID }],
      workspacePaneTabsByTargetByWorkspace: {
        'goblin+file:///repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    const workspacePaneTabsHost = {
      restoreTabs: vi.fn(async () => ({
        kind: 'restored' as const,
        snapshot: { revision: 1, entries: [] },
        repaired: false,
      })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('restored')
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      workspaceId: LOCAL_WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      expectedWorkspaceEntry: { kind: 'local', id: 'goblin+file:///repo' },
      targets: [{ kind: 'workspace-root' }, { kind: 'git-worktree', root: 'goblin+file:///repo' }],
    })
    expect(result.runtime).toMatchObject({
      restoredWorkspaceId: 'goblin+file:///repo',
      workspaces: [
        {
          entry: { kind: 'local', id: 'goblin+file:///repo' },
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'repo-runtime-test',
          name: 'repo',
        },
      ],
      workspacePaneTabs: [
        {
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'repo-runtime-test',
          snapshot: { revision: 1, entries: [] },
        },
      ],
    })
  })

  test('restores a nested directory as a plain Workspace without migrating its identity', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local', id: NESTED_WORKSPACE_ID }],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.probeWorkspace.mockResolvedValue(plainWorkspaceProbe())
    const workspacePaneTabsHost = {
      restoreTabs: vi.fn(async () => ({
        kind: 'restored' as const,
        snapshot: { revision: 0, entries: [] },
        repaired: false,
      })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('restored')
    expect(result.openWorkspaceEntries).toEqual(workspace.openWorkspaceEntries)
    expect(result.runtime.workspaces).toEqual([
      expect.objectContaining({
        workspaceId: 'goblin+file:///repo/src',
        gitProjection: null,
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
      openWorkspaceEntries: [{ kind: 'local', id: LOCAL_WORKSPACE_ID }],
      workspacePaneTabsByTargetByWorkspace: {
        'goblin+file:///repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    const workspacePaneTabsHost = {
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(),
      restoreTabs: vi.fn(async () => ({
        kind: 'restored' as const,
        snapshot: { revision: 3, entries: [] },
        repaired: true,
      })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('repaired')
    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      workspaceId: LOCAL_WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      expectedWorkspaceEntry: { kind: 'local', id: 'goblin+file:///repo' },
      targets: [{ kind: 'workspace-root' }, { kind: 'git-worktree', root: 'goblin+file:///repo' }],
    })
    expect(result.runtime.workspacePaneTabs).toEqual([
      {
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-test',
        snapshot: { revision: 3, entries: [] },
      },
    ])
  })

  test('restores root layout for an active Workspace when its Git projection is temporarily unavailable', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local', id: LOCAL_WORKSPACE_ID }],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.readRepoProjection.mockResolvedValue({ snapshot: null })
    const workspacePaneTabsHost = {
      restoreTabs: vi.fn(async () => ({
        kind: 'restored' as const,
        snapshot: { revision: 0, entries: [] },
        repaired: false,
      })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('restored')
    expect(result.openWorkspaceEntries).toEqual(workspace.openWorkspaceEntries)
    expect(result.runtime.workspaces).toEqual([
      expect.objectContaining({
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-test',
        gitProjection: null,
      }),
    ])
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      workspaceId: LOCAL_WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      expectedWorkspaceEntry: { kind: 'local', id: LOCAL_WORKSPACE_ID },
      targets: [{ kind: 'workspace-root' }],
    })
    expect(result.runtime.workspacePaneTabs).toEqual([
      {
        workspaceId: LOCAL_WORKSPACE_ID,
        workspaceRuntimeId: 'repo-runtime-test',
        snapshot: { revision: 0, entries: [] },
      },
    ])
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('keeps a local repo declaration as a stub when its path is temporarily unavailable', async () => {
    const entry = { kind: 'local' as const, id: LOCAL_WORKSPACE_ID }
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [entry],
    })
    mocks.probeWorkspace.mockResolvedValue({ status: 'unavailable', reason: 'error.workspace-permission-denied' })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('restored')
    expect(result.openWorkspaceEntries).toEqual([entry])
    expect(result.runtime.workspaces).toEqual([
      expect.objectContaining({
        entry,
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-test',
        gitProjection: null,
      }),
    ])
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('keeps an active remote repo as a stub when lifecycle is temporarily unavailable', async () => {
    const remoteEntry = {
      kind: 'remote' as const,
      id: REMOTE_WORKSPACE_ID,
      ref: { id: REMOTE_WORKSPACE_ID, alias: 'prod', remotePath: '/srv/repo', displayName: 'repo' },
    }
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [remoteEntry],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.runRemoteWorkspaceLifecycleWrite.mockResolvedValue({
      kind: 'settled',
      lifecycle: { kind: 'failed', attemptId: 4, reason: 'unreachable' },
      name: 'repo',
    })
    mocks.workspaceProbes.set(remoteEntry.id, {
      status: 'unavailable',
      reason: 'error.workspace-transport-unavailable',
    })
    const workspacePaneTabsHost = {
      restoreTabs: vi.fn(async () => ({
        kind: 'restored' as const,
        snapshot: { revision: 0, entries: [] },
        repaired: false,
      })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('restored')
    expect(result.openWorkspaceEntries).toEqual(workspace.openWorkspaceEntries)
    expect(result.runtime.workspaces[0]).toMatchObject({
      workspaceId: remoteEntry.id,
      workspaceRuntimeId: 'repo-runtime-test',
      gitProjection: null,
      workspaceProbe: { status: 'unavailable', reason: 'error.workspace-transport-unavailable' },
      remoteLifecycle: { kind: 'failed', attemptId: 4, reason: 'unreachable' },
    })
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('releases opened runtimes when workspace tab commit fails unexpectedly', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-branch',
      workspaceId: LOCAL_WORKSPACE_ID,
      branchName: 'main',
    })
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local', id: LOCAL_WORKSPACE_ID }],
      workspacePaneTabsByTargetByWorkspace: {
        'goblin+file:///repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    const commitError = new Error('commit failed')
    const workspacePaneTabsHost = {
      restoreTabs: vi.fn(async () => {
        throw commitError
      }),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    await expect(
      restoreServerWorkspace({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: 'user-test',
        clientId: 'client_test000000000000',
        workspacePaneTabsHost,
      }),
    ).rejects.toBe(commitError)

    expect(mocks.releaseWorkspaceRuntimeMembershipLease).toHaveBeenCalledWith('user-test', 'client_test000000000000', {
      workspaceId: LOCAL_WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
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
      openWorkspaceEntries: [{ kind: 'local', id: LOCAL_WORKSPACE_ID }],
      workspacePaneTabsByTargetByWorkspace: {
        'goblin+file:///repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    const controller = new AbortController()
    const abortReason = new Error('request aborted')
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.readRepoProjection.mockImplementation(async () => {
      controller.abort(abortReason)
      return {
        snapshot: { current: 'main', branches: [{ name: 'main', worktree: { path: '/repo' } }] },
        status: [],
        pullRequests: null,
        operations: { operations: [], loadedAt: 0 },
        requested: { branch: null, pullRequestMode: 'full' },
        loadedAt: 1,
      }
    })
    const workspacePaneTabsHost = {
      restoreTabs: vi.fn(async () => ({
        kind: 'restored' as const,
        snapshot: { revision: 5, entries: [] },
        repaired: false,
      })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    await expect(
      restoreServerWorkspace({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: 'user-test',
        clientId: 'client_test000000000000',
        workspacePaneTabsHost,
        signal: controller.signal,
      }),
    ).rejects.toBe(abortReason)

    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).toHaveBeenCalledWith('user-test', 'client_test000000000000', {
      workspaceId: LOCAL_WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      generation: 1,
    })
  })

  test('releases the acquired remote runtime when remote lifecycle restore is aborted', async () => {
    const remoteEntry = {
      kind: 'remote' as const,
      id: REMOTE_WORKSPACE_ID,
      ref: { id: REMOTE_WORKSPACE_ID, alias: 'prod', remotePath: '/srv/repo', displayName: 'repo' },
    }
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [remoteEntry],
    }
    const controller = new AbortController()
    const abortReason = new Error('remote restore aborted')
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.runRemoteWorkspaceLifecycleWrite.mockImplementation(() => new Promise(() => {}))
    const workspacePaneTabsHost = {
      restoreTabs: vi.fn(async () => ({
        kind: 'restored' as const,
        snapshot: { revision: 0, entries: [] },
        repaired: false,
      })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const restore = restoreServerWorkspace({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      workspacePaneTabsHost,
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(mocks.runRemoteWorkspaceLifecycleWrite).toHaveBeenCalled())
    controller.abort(abortReason)

    await expect(restore).rejects.toBe(abortReason)
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).toHaveBeenCalledOnce()
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).toHaveBeenCalledWith('user-test', 'client_test000000000000', {
      workspaceId: remoteEntry.id,
      workspaceRuntimeId: 'repo-runtime-test',
      generation: 1,
    })
  })

  test('releases opened runtimes when workspace repair persistence fails', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-branch',
      workspaceId: LOCAL_WORKSPACE_ID,
      branchName: 'missing',
    })
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local', id: LOCAL_WORKSPACE_ID }],
      workspacePaneTabsByTargetByWorkspace: {
        'goblin+file:///repo': { [targetKey]: [workspacePaneStaticTabEntry('files')] },
      },
    }
    const persistError = new Error('settings write failed')
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    const workspacePaneTabsHost = {
      restoreTabs: vi.fn(async () => {
        throw persistError
      }),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    await expect(
      restoreServerWorkspace({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: 'user-test',
        clientId: 'client_test000000000000',
        workspacePaneTabsHost,
      }),
    ).rejects.toBe(persistError)

    expect(mocks.releaseWorkspaceRuntimeMembershipLease).toHaveBeenCalledWith('user-test', 'client_test000000000000', {
      workspaceId: LOCAL_WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
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
      openWorkspaceEntries: [{ kind: 'local', id: LOCAL_WORKSPACE_ID }],
      workspacePaneTabsByTargetByWorkspace: {
        'goblin+file:///repo': { [targetKey]: [workspacePaneStaticTabEntry('files')] },
        '/other': { [otherTargetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    const currentWorkspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local', id: LOCAL_WORKSPACE_ID }],
    }
    mocks.getServerWorkspaceState.mockResolvedValueOnce(invalidWorkspace).mockResolvedValueOnce(currentWorkspace)
    mocks.compareAndReplaceServerWorkspaceEntries
      .mockResolvedValueOnce({ matched: true, workspace: invalidWorkspace })
      .mockResolvedValueOnce({ matched: true, workspace: currentWorkspace })
    const workspacePaneTabsHost = {
      restoreTabs: vi.fn(async () => ({
        kind: 'restored' as const,
        snapshot: { revision: 0, entries: [] },
        repaired: false,
      })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: 'user-test',
      clientId: 'client_test000000000000',
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
    name: 'repo',
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
