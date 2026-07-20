import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { ServerWorkspaceState } from '#/shared/api-types.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import { createTestWorkspacePaneTabsHost } from '#/server/test-utils/workspace-pane-tabs-host.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const ACTIVE_WORKSPACE_ID = workspaceIdForTest('goblin+file:///repo-active')
const STUB_WORKSPACE_ID = workspaceIdForTest('goblin+file:///repo-stub')
const NESTED_STUB_WORKSPACE_ID = workspaceIdForTest('goblin+file:///repo-stub/src')
const REPO_A_ID = workspaceIdForTest('goblin+file:///repo-a')
const REPO_B_ID = workspaceIdForTest('goblin+file:///repo-b')
const LOCAL_WORKSPACE_ID = workspaceIdForTest('goblin+file:///repo')
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

describe('restoreServerWorkspace — active-only restore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.workspaceProbes.clear()
    mocks.acquireWorkspaceRuntimeLease.mockImplementation((_userId: string, workspaceId: string) => ({
      workspaceId,
      workspaceRuntimeId: `runtime-${workspaceId.replace(/[^a-z0-9]/gi, '_')}`,
      generation: 1,
    }))
    mocks.isCurrentWorkspaceRuntimeMembership.mockReturnValue(true)
    mocks.probeWorkspace.mockResolvedValue(gitProbe())
    mocks.runRemoteWorkspaceLifecycleWrite.mockResolvedValue({
      kind: 'settled',
      repoId: 'goblin+ssh://prod/srv/repo',
      name: 'prod:repo',
      lifecycle: { kind: 'ready', target: { id: 'goblin+ssh://prod/srv/repo' } },
    })
    mocks.readRepoProjection.mockImplementation(async (workspaceId: string) => ({
      snapshot: { current: 'main', branches: [{ name: 'main', worktree: { path: workspaceId } }] },
      status: [],
      pullRequests: null,
      operations: { operations: [], loadedAt: 0 },
      requested: { branch: null, pullRequestMode: 'full' },
      loadedAt: 1,
    }))
    mocks.compareAndReplaceServerWorkspaceEntries.mockImplementation(
      async (_expected: WorkspaceSessionEntry[], replacement: WorkspaceSessionEntry[]) => {
        const workspace = await mocks.getServerWorkspaceState.mock.results.at(-1)?.value
        return { matched: true, workspace: { ...workspace, openWorkspaceEntries: replacement } }
      },
    )
  })

  test('non-active workspaces restore root layout without eagerly reading the Git projection', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [
        { id: ACTIVE_WORKSPACE_ID },
        { id: STUB_WORKSPACE_ID },
      ],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
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
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('restored')
    // Every local Workspace is capability-probed; only the active Git Workspace is projected.
    expect(mocks.probeWorkspace).toHaveBeenCalledTimes(2)
    expect(mocks.probeWorkspace).toHaveBeenCalledWith('goblin+file:///repo-active', expect.any(String), {
      signal: undefined,
    })
    expect(mocks.probeWorkspace).toHaveBeenCalledWith('goblin+file:///repo-stub', expect.any(String), {
      signal: undefined,
    })
    expect(mocks.readRepoProjection).toHaveBeenCalledTimes(1)
    const repos = result.runtime.workspaces
    const active = repos.find((r) => r.workspaceId === 'goblin+file:///repo-active')!
    const stub = repos.find((r) => r.workspaceId === 'goblin+file:///repo-stub')!
    expect(active.gitProjection).not.toBeNull()
    expect(stub.gitProjection).toBeNull()
    expect(stub.workspaceRuntimeId).toBe('runtime-goblin_file____repo_stub')
    expect(stub.name).toBe('repo')
    // Git targets remain deferred until lazy projection, but workspace-root
    // layout is capability-invariant and can bind immediately.
    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
    expect(result.runtime.workspacePaneTabs).toEqual([
      {
        workspaceId: 'goblin+file:///repo-active',
        workspaceRuntimeId: 'runtime-goblin_file____repo_active',
        snapshot: { revision: 0, entries: [] },
      },
      {
        workspaceId: 'goblin+file:///repo-stub',
        workspaceRuntimeId: 'runtime-goblin_file____repo_stub',
        snapshot: { revision: 0, entries: [] },
      },
    ])
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledTimes(2)
  })

  test('converges to a repo added while restore is opening the original membership', async () => {
    const repoA = { id: REPO_A_ID }
    const repoB = { id: REPO_B_ID }
    const initial = { ...defaultServerWorkspaceState(), openWorkspaceEntries: [repoA] }
    const latest = { ...defaultServerWorkspaceState(), openWorkspaceEntries: [repoA, repoB] }
    mocks.getServerWorkspaceState.mockResolvedValue(initial)
    mocks.compareAndReplaceServerWorkspaceEntries
      .mockResolvedValueOnce({ matched: false, latestWorkspace: latest })
      .mockResolvedValueOnce({ matched: true, workspace: latest })
      .mockResolvedValueOnce({ matched: true, workspace: latest })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      workspacePaneTabsHost,
    })

    expect(result.openWorkspaceEntries).toEqual([repoA, repoB])
    expect(mocks.acquireWorkspaceRuntimeLease).toHaveBeenCalledTimes(2)
    expect(mocks.acquireWorkspaceRuntimeLease).toHaveBeenCalledWith(
      'user-test',
      'goblin+file:///repo-a',
      'client_test000000000000',
    )
    expect(mocks.acquireWorkspaceRuntimeLease).toHaveBeenCalledWith(
      'user-test',
      'goblin+file:///repo-b',
      'client_test000000000000',
    )
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('releases only a repo removed while restore is in flight', async () => {
    const repoA = { id: REPO_A_ID }
    const repoB = { id: REPO_B_ID }
    const initial = { ...defaultServerWorkspaceState(), openWorkspaceEntries: [repoA, repoB] }
    const latest = { ...defaultServerWorkspaceState(), openWorkspaceEntries: [repoB] }
    mocks.getServerWorkspaceState.mockResolvedValue(initial)
    mocks.compareAndReplaceServerWorkspaceEntries
      .mockResolvedValueOnce({ matched: false, latestWorkspace: latest })
      .mockResolvedValueOnce({ matched: true, workspace: latest })
      .mockResolvedValueOnce({ matched: true, workspace: latest })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      workspacePaneTabsHost,
    })

    expect(result.openWorkspaceEntries).toEqual([repoB])
    expect(mocks.acquireWorkspaceRuntimeLease).toHaveBeenCalledTimes(2)
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).toHaveBeenCalledTimes(1)
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).toHaveBeenCalledWith(
      'user-test',
      'client_test000000000000',
      expect.objectContaining({ workspaceId: 'goblin+file:///repo-a' }),
    )
  })

  test('converges when workspace membership changes during pane projection', async () => {
    const repoA = { id: REPO_A_ID }
    const repoB = { id: REPO_B_ID }
    const initial = { ...defaultServerWorkspaceState(), openWorkspaceEntries: [repoA] }
    const latest = { ...defaultServerWorkspaceState(), openWorkspaceEntries: [repoA, repoB] }
    mocks.getServerWorkspaceState.mockResolvedValue(initial)
    mocks.compareAndReplaceServerWorkspaceEntries
      .mockResolvedValueOnce({ matched: true, workspace: initial })
      .mockResolvedValueOnce({ matched: false, latestWorkspace: latest })
      .mockResolvedValueOnce({ matched: true, workspace: latest })
      .mockResolvedValueOnce({ matched: true, workspace: latest })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      workspacePaneTabsHost,
    })

    expect(result.openWorkspaceEntries).toEqual([repoA, repoB])
    expect(mocks.acquireWorkspaceRuntimeLease).toHaveBeenCalledTimes(2)
  })

  test('releases every attempt lease after persistent membership conflicts', async () => {
    const repo = { id: LOCAL_WORKSPACE_ID }
    const workspace = { ...defaultServerWorkspaceState(), openWorkspaceEntries: [repo] }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.compareAndReplaceServerWorkspaceEntries.mockResolvedValue({
      matched: false,
      latestWorkspace: workspace,
    })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    await expect(
      restoreServerWorkspace({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: 'user-test',
        clientId: 'client_test000000000000',
        workspacePaneTabsHost,
      }),
    ).rejects.toThrow('workspace membership restore was superseded too many times')

    expect(mocks.acquireWorkspaceRuntimeLease).toHaveBeenCalledOnce()
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).toHaveBeenCalledOnce()
  })

  test('uses activeWorkspaceId instead of restoredWorkspaceId to choose the eager restore repo', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [
        { id: REPO_A_ID },
        { id: REPO_B_ID },
      ],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
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
    const result = await restoreServerWorkspace({
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      userId: 'user-test',
      clientId: 'client_test000000000000',
      activeWorkspaceId: REPO_B_ID,
      workspacePaneTabsHost,
    })

    expect(mocks.probeWorkspace).toHaveBeenCalledTimes(2)
    expect(mocks.probeWorkspace).toHaveBeenCalledWith('goblin+file:///repo-a', expect.any(String), {
      signal: undefined,
    })
    expect(mocks.probeWorkspace).toHaveBeenCalledWith('goblin+file:///repo-b', expect.any(String), {
      signal: undefined,
    })
    expect(mocks.readRepoProjection).toHaveBeenCalledTimes(1)
    expect(result.runtime.workspaces.find((r) => r.workspaceId === 'goblin+file:///repo-a')?.gitProjection).toBeNull()
    expect(
      result.runtime.workspaces.find((r) => r.workspaceId === 'goblin+file:///repo-b')?.gitProjection,
    ).not.toBeNull()
  })

  test('restores a non-active nested directory as a plain Workspace', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [
        { id: ACTIVE_WORKSPACE_ID },
        { id: NESTED_STUB_WORKSPACE_ID },
      ],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.probeWorkspace.mockImplementation(async (workspaceId: string) =>
      workspaceId === NESTED_STUB_WORKSPACE_ID ? plainWorkspaceProbe() : gitProbe(),
    )
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
    expect(result.runtime.workspaces).toHaveLength(2)
    expect(result.runtime.workspaces[1]).toMatchObject({
      workspaceId: 'goblin+file:///repo-stub/src',
      gitProjection: null,
      workspaceProbe: { capabilities: { git: { status: 'unavailable' } } },
    })
    expect(TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST.commitGitCapabilityRemoval).toHaveBeenCalledWith({
      userId: 'user-test',
      workspaceId: 'goblin+file:///repo-stub/src',
      workspaceRuntimeId: 'runtime-goblin_file____repo_stub_src',
      assertCurrent: expect.any(Function),
    })
    expect(TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST.commitGitCapabilityRemoval).toHaveBeenCalledOnce()
    expect(mocks.readRepoProjection).toHaveBeenCalledTimes(1)
  })

  test('non-active remote Workspaces are probed and retain their display name', async () => {
    const remoteEntry = { id: REMOTE_WORKSPACE_ID }
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: ACTIVE_WORKSPACE_ID }, remoteEntry],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
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

    const remoteStub = result.runtime.workspaces.find((r) => r.workspaceId === remoteEntry.id)!
    expect(remoteStub).toMatchObject({
      entry: remoteEntry,
      workspaceId: remoteEntry.id,
      name: 'prod:repo',
      gitProjection: null,
    })
    expect(mocks.runRemoteWorkspaceLifecycleWrite).toHaveBeenCalledOnce()
  })

  test('restores the workspace scope for non-active Git stubs without eagerly validating Git targets', async () => {
    const staleTargetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-branch',
      workspaceId: STUB_WORKSPACE_ID,
      branchName: 'feature',
    })
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [
        { id: ACTIVE_WORKSPACE_ID },
        { id: STUB_WORKSPACE_ID },
      ],
      workspacePaneTabsByTargetByWorkspace: {
        // The Git target cannot be validated without the deferred projection;
        // workspace-level tabs can still be restored independently.
        'goblin+file:///repo-stub': { [staleTargetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
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
  })

  test('restores workspace-root layout while Git enrichment remains deferred after an operational diagnostic', async () => {
    const workspaceId = 'goblin+file:///repo'
    const workspace = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: workspaceId }],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.workspaceProbes.set(workspaceId, {
      status: 'ready',
      name: 'repo',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [{ scope: 'git', message: 'Git probe timed out' }],
    })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      workspacePaneTabsHost,
    })

    expect(result.runtime.workspaces[0]).toMatchObject({ gitProjection: null, workspaceProbe: { status: 'ready' } })
    expect(mocks.readRepoProjection).not.toHaveBeenCalled()
    expect(TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST.commitGitCapabilityRemoval).not.toHaveBeenCalled()
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      workspaceId,
      workspaceRuntimeId: expect.any(String),
      expectedWorkspaceEntry: { id: workspaceId },
      targets: [{ kind: 'workspace-root' }],
    })
    expect(result.runtime.workspacePaneTabs).toEqual([
      {
        workspaceId,
        workspaceRuntimeId: expect.any(String),
        snapshot: { revision: 0, entries: [] },
      },
    ])
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
