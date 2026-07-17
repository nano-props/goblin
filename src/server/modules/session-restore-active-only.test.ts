import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { ServerWorkspaceState } from '#/shared/api-types.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-repo.ts'
import { createTestWorkspacePaneTabsHost } from '#/server/test-utils/workspace-pane-tabs-host.ts'

const mocks = vi.hoisted(() => ({
  acquireRepoRuntimeLease: vi.fn(),
  releaseRepoRuntimeMembershipLease: vi.fn(),
  isCurrentRepoRuntimeMembership: vi.fn(),
  getServerWorkspaceState: vi.fn(),
  compareAndReplaceServerWorkspaceRepos: vi.fn(),
  confirmServerWorkspaceRepoEntry: vi.fn(),
  probeRepo: vi.fn(),
  readRepoProjection: vi.fn(),
  runRemoteLifecycleWrite: vi.fn(),
  workspaceProbes: new Map<string, unknown>(),
}))

const TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST = { removeGitScopedResources: vi.fn() }

vi.mock('#/server/modules/repo-runtimes.ts', () => ({
  acquireRepoRuntimeLease: mocks.acquireRepoRuntimeLease,
  releaseRepoRuntimeMembershipLease: mocks.releaseRepoRuntimeMembershipLease,
  isCurrentRepoRuntimeMembership: mocks.isCurrentRepoRuntimeMembership,
  commitWorkspaceProbeState: vi.fn((input) => {
    mocks.workspaceProbes.set(input.repoRoot, input.probe)
    return true
  }),
  commitOrReadInitialWorkspaceProbeState: vi.fn((input) => {
    const current = mocks.workspaceProbes.get(input.repoRoot)
    if (current) return current
    mocks.workspaceProbes.set(input.repoRoot, input.probe)
    return input.probe
  }),
  runSerializedInitialWorkspaceProbe: vi.fn(async (input) => {
    const current = mocks.workspaceProbes.get(input.repoRoot)
    if (current && (current as { status: string }).status !== 'probing') return current
    const probe = await input.probe()
    await input.beforeCommit?.({ before: { status: 'probing' }, after: probe })
    mocks.workspaceProbes.set(input.repoRoot, probe)
    return probe
  }),
  workspaceProbeStateForRuntime: vi.fn(
    (_userId, repoRoot) => mocks.workspaceProbes.get(repoRoot) ?? { status: 'probing' },
  ),
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerWorkspaceState: mocks.getServerWorkspaceState,
  compareAndReplaceServerWorkspaceRepos: mocks.compareAndReplaceServerWorkspaceRepos,
  confirmServerWorkspaceRepoEntry: mocks.confirmServerWorkspaceRepoEntry,
}))

vi.mock('#/server/modules/repo-read-paths.ts', () => ({
  readRepoProjection: mocks.readRepoProjection,
}))

vi.mock('#/server/modules/workspace-probe.ts', () => ({
  probeWorkspace: vi.fn(async (repoRoot: string) =>
    workspaceProbeFromLegacy(repoRoot, await mocks.probeRepo(repoRoot)),
  ),
}))

vi.mock('#/server/modules/remote-lifecycle-write-paths.ts', () => ({
  runRemoteLifecycleWrite: mocks.runRemoteLifecycleWrite,
}))

describe('restoreServerWorkspace — active-only restore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.workspaceProbes.clear()
    mocks.acquireRepoRuntimeLease.mockImplementation((_userId: string, repoRoot: string) => ({
      repoRoot,
      repoRuntimeId: `runtime-${repoRoot.replace(/[^a-z0-9]/gi, '_')}`,
      generation: 1,
    }))
    mocks.isCurrentRepoRuntimeMembership.mockReturnValue(true)
    mocks.probeRepo.mockImplementation(async (repoRoot: string) => ({ ok: true, root: repoRoot, name: 'repo' }))
    mocks.runRemoteLifecycleWrite.mockResolvedValue({
      kind: 'settled',
      repoId: 'goblin+ssh://prod/srv/repo',
      name: 'prod:repo',
      lifecycle: { kind: 'ready', target: { id: 'goblin+ssh://prod/srv/repo' } },
    })
    mocks.readRepoProjection.mockImplementation(async (repoRoot: string) => ({
      snapshot: { current: 'main', branches: [{ name: 'main', worktree: { path: repoRoot } }] },
      status: [],
      pullRequests: null,
      operations: { operations: [], loadedAt: 0 },
      requested: { branch: null, pullRequestMode: 'full' },
      loadedAt: 1,
    }))
    mocks.compareAndReplaceServerWorkspaceRepos.mockImplementation(
      async (_expected: WorkspaceSessionEntry[], replacement: WorkspaceSessionEntry[]) => {
        const workspace = await mocks.getServerWorkspaceState.mock.results.at(-1)?.value
        return { matched: true, workspace: { ...workspace, openWorkspaceEntries: replacement } }
      },
    )
  })

  test('non-active repos are validated stubs — no projection read, projection: null', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [
        { kind: 'local', id: 'goblin+file:///repo-active' },
        { kind: 'local', id: 'goblin+file:///repo-stub' },
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
    // All local repos are probed for canonical identity; only the active repo is projected.
    expect(mocks.probeRepo).toHaveBeenCalledTimes(2)
    expect(mocks.probeRepo).toHaveBeenCalledWith('goblin+file:///repo-active')
    expect(mocks.probeRepo).toHaveBeenCalledWith('goblin+file:///repo-stub')
    expect(mocks.readRepoProjection).toHaveBeenCalledTimes(1)
    const repos = result.runtime.repos
    const active = repos.find((r) => r.repoRoot === 'goblin+file:///repo-active')!
    const stub = repos.find((r) => r.repoRoot === 'goblin+file:///repo-stub')!
    expect(active.projection).not.toBeNull()
    expect(stub.projection).toBeNull()
    expect(stub.repoRuntimeId).toBe('runtime-goblin_file____repo_stub')
    expect(stub.name).toBe('repo')
    // Every readable workspace contributes its workspace-level tabs scope;
    // only the active repo performs the Git projection read.
    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
    expect(result.runtime.workspacePaneTabs).toEqual([
      {
        repoRoot: 'goblin+file:///repo-active',
        repoRuntimeId: 'runtime-goblin_file____repo_active',
        snapshot: { revision: 0, entries: [] },
      },
      {
        repoRoot: 'goblin+file:///repo-stub',
        repoRuntimeId: 'runtime-goblin_file____repo_stub',
        snapshot: { revision: 0, entries: [] },
      },
    ])
  })

  test('converges to a repo added while restore is opening the original membership', async () => {
    const repoA = { kind: 'local' as const, id: 'goblin+file:///repo-a' }
    const repoB = { kind: 'local' as const, id: 'goblin+file:///repo-b' }
    const initial = { ...defaultServerWorkspaceState(), openWorkspaceEntries: [repoA] }
    const latest = { ...defaultServerWorkspaceState(), openWorkspaceEntries: [repoA, repoB] }
    mocks.getServerWorkspaceState.mockResolvedValue(initial)
    mocks.compareAndReplaceServerWorkspaceRepos
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
    expect(mocks.acquireRepoRuntimeLease).toHaveBeenCalledTimes(2)
    expect(mocks.acquireRepoRuntimeLease).toHaveBeenCalledWith(
      'user-test',
      'goblin+file:///repo-a',
      'client_test000000000000',
    )
    expect(mocks.acquireRepoRuntimeLease).toHaveBeenCalledWith(
      'user-test',
      'goblin+file:///repo-b',
      'client_test000000000000',
    )
    expect(mocks.releaseRepoRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('releases only a repo removed while restore is in flight', async () => {
    const repoA = { kind: 'local' as const, id: 'goblin+file:///repo-a' }
    const repoB = { kind: 'local' as const, id: 'goblin+file:///repo-b' }
    const initial = { ...defaultServerWorkspaceState(), openWorkspaceEntries: [repoA, repoB] }
    const latest = { ...defaultServerWorkspaceState(), openWorkspaceEntries: [repoB] }
    mocks.getServerWorkspaceState.mockResolvedValue(initial)
    mocks.compareAndReplaceServerWorkspaceRepos
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
    expect(mocks.acquireRepoRuntimeLease).toHaveBeenCalledTimes(2)
    expect(mocks.releaseRepoRuntimeMembershipLease).toHaveBeenCalledTimes(1)
    expect(mocks.releaseRepoRuntimeMembershipLease).toHaveBeenCalledWith(
      'user-test',
      'client_test000000000000',
      expect.objectContaining({ repoRoot: 'goblin+file:///repo-a' }),
    )
  })

  test('converges when workspace membership changes during pane projection', async () => {
    const repoA = { kind: 'local' as const, id: 'goblin+file:///repo-a' }
    const repoB = { kind: 'local' as const, id: 'goblin+file:///repo-b' }
    const initial = { ...defaultServerWorkspaceState(), openWorkspaceEntries: [repoA] }
    const latest = { ...defaultServerWorkspaceState(), openWorkspaceEntries: [repoA, repoB] }
    mocks.getServerWorkspaceState.mockResolvedValue(initial)
    mocks.compareAndReplaceServerWorkspaceRepos
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
    expect(mocks.acquireRepoRuntimeLease).toHaveBeenCalledTimes(2)
  })

  test('releases every attempt lease after persistent membership conflicts', async () => {
    const repo = { kind: 'local' as const, id: 'goblin+file:///repo' }
    const workspace = { ...defaultServerWorkspaceState(), openWorkspaceEntries: [repo] }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.compareAndReplaceServerWorkspaceRepos.mockResolvedValue({
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

    expect(mocks.acquireRepoRuntimeLease).toHaveBeenCalledOnce()
    expect(mocks.releaseRepoRuntimeMembershipLease).toHaveBeenCalledOnce()
  })

  test('uses activeRepoRoot instead of restoredRepoId to choose the eager restore repo', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [
        { kind: 'local', id: 'goblin+file:///repo-a' },
        { kind: 'local', id: 'goblin+file:///repo-b' },
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
      activeRepoRoot: 'goblin+file:///repo-b',
      workspacePaneTabsHost,
    })

    expect(mocks.probeRepo).toHaveBeenCalledTimes(2)
    expect(mocks.probeRepo).toHaveBeenCalledWith('goblin+file:///repo-a')
    expect(mocks.probeRepo).toHaveBeenCalledWith('goblin+file:///repo-b')
    expect(mocks.readRepoProjection).toHaveBeenCalledTimes(1)
    expect(result.runtime.repos.find((r) => r.repoRoot === 'goblin+file:///repo-a')?.projection).toBeNull()
    expect(result.runtime.repos.find((r) => r.repoRoot === 'goblin+file:///repo-b')?.projection).not.toBeNull()
  })

  test('rebuilds when a non-active local entry is not canonical', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [
        { kind: 'local', id: 'goblin+file:///repo-active' },
        { kind: 'local', id: 'goblin+file:///repo-stub/src' },
      ],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.probeRepo.mockImplementation(async (repoRoot: string) => ({
      ok: true,
      root: repoRoot === 'goblin+file:///repo-stub/src' ? '/repo-stub' : repoRoot,
      name: 'repo',
    }))
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
    expect(result.runtime.repos).toHaveLength(2)
    expect(result.runtime.repos[1]).toMatchObject({
      repoRoot: 'goblin+file:///repo-stub/src',
      projection: null,
      workspaceProbe: { capabilities: { git: { status: 'unavailable' } } },
    })
    expect(TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST.removeGitScopedResources).toHaveBeenCalledWith({
      userId: 'user-test',
      workspaceId: 'goblin+file:///repo-stub/src',
      workspaceRuntimeId: 'runtime-goblin_file____repo_stub_src',
      assertCurrent: expect.any(Function),
    })
    expect(TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST.removeGitScopedResources).toHaveBeenCalledOnce()
    expect(mocks.readRepoProjection).toHaveBeenCalledTimes(1)
  })

  test('non-active remote repos are probed and retain their display name', async () => {
    const remoteEntry = {
      kind: 'remote' as const,
      id: 'goblin+ssh://prod/srv/repo',
      ref: {
        id: 'goblin+ssh://prod/srv/repo',
        alias: 'prod',
        remotePath: '/srv/repo',
        displayName: 'prod:repo',
      },
    }
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local', id: 'goblin+file:///repo-active' }, remoteEntry],
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

    const remoteStub = result.runtime.repos.find((r) => r.repoRoot === remoteEntry.id)!
    expect(remoteStub).toMatchObject({
      entry: remoteEntry,
      repoRoot: remoteEntry.id,
      name: 'prod:repo',
      projection: null,
    })
    expect(mocks.runRemoteLifecycleWrite).toHaveBeenCalledOnce()
  })

  test('restores the workspace scope for non-active Git stubs without eagerly validating Git targets', async () => {
    const staleTargetKey = workspacePaneTabsTargetIdentityKey({
      repoRoot: 'goblin+file:///repo-stub',
      branchName: 'feature',
      worktreePath: null,
    })
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [
        { kind: 'local', id: 'goblin+file:///repo-active' },
        { kind: 'local', id: 'goblin+file:///repo-stub' },
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

  test('restores workspace-level layout when Git enrichment has a diagnostic', async () => {
    const repoRoot = 'goblin+file:///repo'
    const workspace = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local' as const, id: repoRoot }],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.workspaceProbes.set(repoRoot, {
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

    expect(result.runtime.repos[0]).toMatchObject({ projection: null, workspaceProbe: { status: 'ready' } })
    expect(mocks.readRepoProjection).not.toHaveBeenCalled()
    expect(TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST.removeGitScopedResources).not.toHaveBeenCalled()
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      workspaceId: repoRoot,
      workspaceRuntimeId: 'runtime-goblin_file____repo',
      expectedRepoEntry: { kind: 'local', id: repoRoot },
      targets: [{ kind: 'workspace' }],
    })
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

function workspaceProbeFromLegacy(repoRoot: string, result: { ok: boolean; root?: string; name?: string }) {
  const reportedRoot = result.root?.startsWith('goblin+')
    ? result.root
    : result.root
      ? `goblin+file://${result.root}`
      : null
  return result.ok
    ? reportedRoot && reportedRoot !== repoRoot
      ? {
          ...gitProbe(),
          name: result.name ?? 'repo',
          capabilities: { ...gitProbe().capabilities, git: { status: 'unavailable' as const } },
        }
      : { ...gitProbe(), name: result.name ?? 'repo' }
    : { status: 'unavailable' as const, reason: 'error.workspace-transport-unavailable' as const }
}
