import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { ServerWorkspaceState } from '#/shared/api-types.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'

const mocks = vi.hoisted(() => ({
  acquireRepoRuntimeLease: vi.fn(),
  releaseRepoRuntimeMembershipLease: vi.fn(),
  isCurrentRepoRuntimeMembership: vi.fn(),
  getServerWorkspaceState: vi.fn(),
  compareAndReplaceServerWorkspaceRepos: vi.fn(),
  confirmServerWorkspaceRepoEntry: vi.fn(),
  confirmServerWorkspaceTabsUnchanged: vi.fn(),
  clearServerWorkspaceTabsIfUnchanged: vi.fn(),
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
  confirmServerWorkspaceTabsUnchanged: mocks.confirmServerWorkspaceTabsUnchanged,
  clearServerWorkspaceTabsIfUnchanged: mocks.clearServerWorkspaceTabsIfUnchanged,
}))

vi.mock('#/server/modules/repo-read-paths.ts', () => ({
  probeRepo: mocks.probeRepo,
  readRepoProjection: mocks.readRepoProjection,
}))

vi.mock('#/server/modules/remote-lifecycle-write-paths.ts', () => ({
  runRemoteLifecycleWrite: mocks.runRemoteLifecycleWrite,
}))

describe('restoreRepoTabsForRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.acquireRepoRuntimeLease.mockImplementation((_userId: string, repoRoot: string) => ({
      repoRoot,
      repoRuntimeId: 'repo-runtime-test',
      generation: 1,
    }))
    mocks.isCurrentRepoRuntimeMembership.mockReturnValue(true)
    mocks.probeRepo.mockImplementation(async (repoRoot: string) => ({ ok: true, root: repoRoot, name: 'repo' }))
    mocks.readRepoProjection.mockResolvedValue({
      snapshot: { current: 'main', branches: [{ name: 'main', worktree: { path: '/repo' } }] },
      status: [],
      pullRequests: null,
      operations: { operations: [], loadedAt: 0 },
      requested: { branch: null, pullRequestMode: 'full' },
      loadedAt: 1,
    })
    mocks.clearServerWorkspaceTabsIfUnchanged.mockResolvedValue({
      cleared: true,
      workspace: { workspacePaneTabsByTargetByRepo: {} },
    })
    mocks.confirmServerWorkspaceRepoEntry.mockImplementation(async () => ({
      matched: true,
      workspace: await mocks.getServerWorkspaceState.mock.results.at(-1)?.value,
    }))
    mocks.confirmServerWorkspaceTabsUnchanged.mockImplementation(async () => ({
      matched: true,
      workspace: await mocks.getServerWorkspaceState.mock.results.at(-1)?.value,
    }))
  })

  test('probes + projects + restores tabs for a single repo', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({ repoRoot: '/repo', branchName: 'main', worktreePath: null })
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      workspacePaneTabsByTargetByRepo: {
        '/repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 5, entries: [] })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 5, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    const result = await restoreRepoTabsForRepo({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      workspacePaneTabsHost,
    })

    expect(result.repo).toMatchObject({
      entry: { kind: 'local', id: '/repo' },
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      name: 'repo',
    })
    expect(result.repo.projection).not.toBeNull()
    expect(result.snapshot).toEqual({ revision: 5, entries: [] })
    expect(mocks.probeRepo).toHaveBeenCalledWith('/repo')
    expect(mocks.acquireRepoRuntimeLease).not.toHaveBeenCalled()
    expect(mocks.releaseRepoRuntimeMembershipLease).not.toHaveBeenCalled()
    expect(workspacePaneTabsHost.initializeTabs).toHaveBeenCalledWith('user-test', {
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      entries: [
        {
          repoRoot: '/repo',
          branchName: 'main',
          worktreePath: null,
          tabs: [workspacePaneStaticTabEntry('history')],
        },
      ],
    })
  })

  test('repairs invalid deferred tab state before initializing the runtime scope', async () => {
    const staleTargetKey = workspacePaneTabsTargetIdentityKey({
      repoRoot: '/repo',
      branchName: 'deleted-branch',
      worktreePath: null,
    })
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      workspacePaneTabsByTargetByRepo: {
        '/repo': { [staleTargetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 5, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    const result = await restoreRepoTabsForRepo({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      workspacePaneTabsHost,
    })

    expect(result.snapshot).toEqual({ revision: 0, entries: [] })
    expect(result.repo.projection).not.toBeNull()
    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
    expect(mocks.clearServerWorkspaceTabsIfUnchanged).toHaveBeenCalledWith({
      repoRoot: '/repo',
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      expectedTabsByTarget: {
        [staleTargetKey]: [workspacePaneStaticTabEntry('history')],
      },
    })
    expect(workspacePaneTabsHost.initializeTabs).toHaveBeenCalledWith('user-test', {
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      entries: [],
    })
  })

  test('throws repo-runtime-stale when clientId/repoRuntimeId does not match the active lease', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.isCurrentRepoRuntimeMembership.mockReturnValue(false)
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(),
      updateTabs: vi.fn(),
    }

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: '/repo',
        repoRuntimeId: 'stale-runtime',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'error.repo-runtime-stale' })
    expect(mocks.probeRepo).not.toHaveBeenCalled()
  })

  test('rejects lazy restore when the repo is absent from server workspace membership', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openRepoEntries: [{ kind: 'local', id: '/other' }],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(),
      updateTabs: vi.fn(),
    }

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: '/repo',
        repoRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })
    expect(mocks.getServerWorkspaceState).toHaveBeenCalledOnce()
  })

  test('rejects lazy restore when the repo is closed during projection', async () => {
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
    })
    mocks.confirmServerWorkspaceRepoEntry.mockResolvedValue({
      matched: false,
      latestWorkspace: defaultServerWorkspaceState(),
    })
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(),
      updateTabs: vi.fn(),
    }

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: '/repo',
        repoRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })
    expect(workspacePaneTabsHost.initializeTabs).not.toHaveBeenCalled()
  })

  test('rejects lazy restore when the repo is closed during pane initialization', async () => {
    const entry = { kind: 'local' as const, id: '/repo' }
    const workspace = { ...defaultServerWorkspaceState(), openRepoEntries: [entry] }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.confirmServerWorkspaceRepoEntry
      .mockResolvedValueOnce({ matched: true, workspace })
      .mockResolvedValueOnce({ matched: true, workspace })
      .mockResolvedValueOnce({ matched: false, latestWorkspace: defaultServerWorkspaceState() })
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(),
      updateTabs: vi.fn(),
    }

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: '/repo',
        repoRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })
    expect(workspacePaneTabsHost.initializeTabs).toHaveBeenCalledOnce()
  })

  test('does not repair pane tabs after repo membership is removed', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      repoRoot: '/repo',
      branchName: 'deleted',
      worktreePath: null,
    })
    const workspace = {
      ...defaultServerWorkspaceState(),
      openRepoEntries: [{ kind: 'local' as const, id: '/repo' }],
      workspacePaneTabsByTargetByRepo: {
        '/repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.confirmServerWorkspaceRepoEntry.mockResolvedValueOnce({ matched: true, workspace })
    mocks.clearServerWorkspaceTabsIfUnchanged.mockResolvedValue({
      cleared: false,
      latestWorkspace: defaultServerWorkspaceState(),
    })
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(),
      updateTabs: vi.fn(),
    }

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: '/repo',
        repoRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })
    expect(workspacePaneTabsHost.initializeTabs).not.toHaveBeenCalled()
  })

  test('keeps the existing membership when lazy local projection fails', async () => {
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
    })
    mocks.readRepoProjection.mockResolvedValue({ snapshot: null })
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(),
      updateTabs: vi.fn(),
    }

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: '/repo',
        repoRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'error.failed-read-repo' })
    expect(mocks.acquireRepoRuntimeLease).not.toHaveBeenCalled()
    expect(mocks.releaseRepoRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('keeps the existing membership when lazy remote ensure fails', async () => {
    const remoteEntry = {
      kind: 'remote' as const,
      id: 'ssh-config://host/repo',
      ref: { id: 'ssh-config://host/repo', alias: 'host', remotePath: '/repo', displayName: 'repo' },
    }
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openRepoEntries: [remoteEntry],
    })
    mocks.runRemoteLifecycleWrite.mockResolvedValue({
      kind: 'settled',
      lifecycle: { kind: 'failed', reason: 'unreachable' },
      name: 'repo',
    })
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(),
      updateTabs: vi.fn(),
    }

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: remoteEntry.id,
        repoRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'error.failed-read-repo' })
    expect(mocks.acquireRepoRuntimeLease).not.toHaveBeenCalled()
    expect(mocks.releaseRepoRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('rejects a projection if the membership becomes stale while reading', async () => {
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
    })
    mocks.isCurrentRepoRuntimeMembership
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(),
      updateTabs: vi.fn(),
    }

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: '/repo',
        repoRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'error.repo-runtime-stale' })
    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
  })
})
