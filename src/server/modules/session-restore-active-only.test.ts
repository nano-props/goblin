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
}))

vi.mock('#/server/modules/repo-runtimes.ts', () => ({
  acquireRepoRuntimeLease: mocks.acquireRepoRuntimeLease,
  releaseRepoRuntimeMembershipLease: mocks.releaseRepoRuntimeMembershipLease,
  isCurrentRepoRuntimeMembership: mocks.isCurrentRepoRuntimeMembership,
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerWorkspaceState: mocks.getServerWorkspaceState,
  compareAndReplaceServerWorkspaceRepos: mocks.compareAndReplaceServerWorkspaceRepos,
  confirmServerWorkspaceRepoEntry: mocks.confirmServerWorkspaceRepoEntry,
}))

vi.mock('#/server/modules/repo-read-paths.ts', () => ({
  probeRepo: mocks.probeRepo,
  readRepoProjection: mocks.readRepoProjection,
}))

vi.mock('#/server/modules/remote-lifecycle-write-paths.ts', () => ({
  runRemoteLifecycleWrite: mocks.runRemoteLifecycleWrite,
}))

describe('restoreServerWorkspace — active-only restore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.acquireRepoRuntimeLease.mockImplementation((_userId: string, repoRoot: string) => ({
      repoRoot,
      repoRuntimeId: `runtime-${repoRoot.replace(/[^a-z0-9]/gi, '_')}`,
      generation: 1,
    }))
    mocks.isCurrentRepoRuntimeMembership.mockReturnValue(true)
    mocks.probeRepo.mockImplementation(async (repoRoot: string) => ({ ok: true, root: repoRoot, name: 'repo' }))
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
        { kind: 'local', id: '/repo-active' },
        { kind: 'local', id: '/repo-stub' },
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
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('restored')
    // All local repos are probed for canonical identity; only the active repo is projected.
    expect(mocks.probeRepo).toHaveBeenCalledTimes(2)
    expect(mocks.probeRepo).toHaveBeenCalledWith('/repo-active')
    expect(mocks.probeRepo).toHaveBeenCalledWith('/repo-stub')
    expect(mocks.readRepoProjection).toHaveBeenCalledTimes(1)
    const repos = result.runtime.repos
    const active = repos.find((r) => r.repoRoot === '/repo-active')!
    const stub = repos.find((r) => r.repoRoot === '/repo-stub')!
    expect(active.projection).not.toBeNull()
    expect(stub.projection).toBeNull()
    expect(stub.repoRuntimeId).toBe('runtime-_repo_stub')
    expect(stub.name).toBe('repo')
    // Only the projected active repo contributes a tabs scope snapshot.
    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
    expect(result.runtime.workspacePaneTabs).toEqual([
      {
        repoRoot: '/repo-active',
        repoRuntimeId: 'runtime-_repo_active',
        snapshot: { revision: 0, entries: [] },
      },
    ])
  })

  test('converges to a repo added while restore is opening the original membership', async () => {
    const repoA = { kind: 'local' as const, id: '/repo-a' }
    const repoB = { kind: 'local' as const, id: '/repo-b' }
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
      workspacePaneTabsHost,
    })

    expect(result.openWorkspaceEntries).toEqual([repoA, repoB])
    expect(mocks.acquireRepoRuntimeLease).toHaveBeenCalledTimes(2)
    expect(mocks.acquireRepoRuntimeLease).toHaveBeenCalledWith('user-test', '/repo-a', 'client_test000000000000')
    expect(mocks.acquireRepoRuntimeLease).toHaveBeenCalledWith('user-test', '/repo-b', 'client_test000000000000')
    expect(mocks.releaseRepoRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('releases only a repo removed while restore is in flight', async () => {
    const repoA = { kind: 'local' as const, id: '/repo-a' }
    const repoB = { kind: 'local' as const, id: '/repo-b' }
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
      workspacePaneTabsHost,
    })

    expect(result.openWorkspaceEntries).toEqual([repoB])
    expect(mocks.acquireRepoRuntimeLease).toHaveBeenCalledTimes(2)
    expect(mocks.releaseRepoRuntimeMembershipLease).toHaveBeenCalledTimes(1)
    expect(mocks.releaseRepoRuntimeMembershipLease).toHaveBeenCalledWith(
      'user-test',
      'client_test000000000000',
      expect.objectContaining({ repoRoot: '/repo-a' }),
    )
  })

  test('converges when workspace membership changes during pane projection', async () => {
    const repoA = { kind: 'local' as const, id: '/repo-a' }
    const repoB = { kind: 'local' as const, id: '/repo-b' }
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
      workspacePaneTabsHost,
    })

    expect(result.openWorkspaceEntries).toEqual([repoA, repoB])
    expect(mocks.acquireRepoRuntimeLease).toHaveBeenCalledTimes(2)
  })

  test('releases every attempt lease after persistent membership conflicts', async () => {
    const repo = { kind: 'local' as const, id: '/repo' }
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
        { kind: 'local', id: '/repo-a' },
        { kind: 'local', id: '/repo-b' },
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
      userId: 'user-test',
      clientId: 'client_test000000000000',
      activeRepoRoot: '/repo-b',
      workspacePaneTabsHost,
    })

    expect(mocks.probeRepo).toHaveBeenCalledTimes(2)
    expect(mocks.probeRepo).toHaveBeenCalledWith('/repo-a')
    expect(mocks.probeRepo).toHaveBeenCalledWith('/repo-b')
    expect(mocks.readRepoProjection).toHaveBeenCalledTimes(1)
    expect(result.runtime.repos.find((r) => r.repoRoot === '/repo-a')?.projection).toBeNull()
    expect(result.runtime.repos.find((r) => r.repoRoot === '/repo-b')?.projection).not.toBeNull()
  })

  test('rebuilds when a non-active local entry is not canonical', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [
        { kind: 'local', id: '/repo-active' },
        { kind: 'local', id: '/repo-stub/src' },
      ],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.probeRepo.mockImplementation(async (repoRoot: string) => ({
      ok: true,
      root: repoRoot === '/repo-stub/src' ? '/repo-stub' : repoRoot,
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
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('repaired')
    expect(result.openWorkspaceEntries).toEqual([{ kind: 'local', id: '/repo-active' }])
    expect(result.runtime.repos).toHaveLength(1)
    expect(result.runtime.repos[0]).toMatchObject({ repoRoot: '/repo-active' })
    expect(mocks.readRepoProjection).toHaveBeenCalledTimes(1)
  })

  test('non-active remote repos use their display name without opening remote lifecycle', async () => {
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
      openWorkspaceEntries: [{ kind: 'local', id: '/repo-active' }, remoteEntry],
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
      workspacePaneTabsHost,
    })

    const remoteStub = result.runtime.repos.find((r) => r.repoRoot === remoteEntry.id)!
    expect(remoteStub).toMatchObject({
      entry: remoteEntry,
      repoRoot: remoteEntry.id,
      name: 'prod:repo',
      projection: null,
    })
    expect(mocks.runRemoteLifecycleWrite).not.toHaveBeenCalled()
  })

  test('non-active repos with stale tabs are ignored during validation', async () => {
    const staleTargetKey = workspacePaneTabsTargetIdentityKey({
      repoRoot: '/repo-stub',
      branchName: 'feature',
      worktreePath: null,
    })
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [
        { kind: 'local', id: '/repo-active' },
        { kind: 'local', id: '/repo-stub' },
      ],
      workspacePaneTabsByTargetByWorkspace: {
        // Stale tab entry for the stub repo that would normally force a
        // rebuild — but plan B skips validation for stubs.
        '/repo-stub': { [staleTargetKey]: [workspacePaneStaticTabEntry('history')] },
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
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('restored')
  })
})
