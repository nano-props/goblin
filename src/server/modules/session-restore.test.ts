import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { ServerWorkspaceState } from '#/shared/api-types.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
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

describe('restoreServerWorkspace', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.acquireRepoRuntimeLease.mockImplementation((_userId: string, repoRoot: string) => ({
      repoRoot,
      repoRuntimeId: 'repo-runtime-test',
      generation: 1,
    }))
    mocks.isCurrentRepoRuntimeMembership.mockReturnValue(true)
    mocks.probeRepo.mockResolvedValue({ ok: true, root: '/repo', name: 'repo' })
    mocks.readRepoProjection.mockResolvedValue({
      snapshot: { current: 'main', branches: [{ name: 'main', worktree: { path: '/repo' } }] },
      status: [],
      pullRequests: null,
      operations: { operations: [], loadedAt: 0 },
      requested: { branch: null, pullRequestMode: 'full' },
      loadedAt: 1,
    })
    mocks.compareAndReplaceServerWorkspaceRepos.mockImplementation(
      async (_expected: RepoSessionEntry[], replacement: RepoSessionEntry[]) => {
        const workspace = await mocks.getServerWorkspaceState.mock.results.at(-1)?.value
        return { matched: true, workspace: { ...workspace, openRepoEntries: replacement } }
      },
    )
    mocks.confirmServerWorkspaceRepoEntry.mockImplementation(async (entry: RepoSessionEntry) => ({
      matched: true,
      workspace: { openRepoEntries: [entry], workspacePaneTabsByTargetByRepo: {} },
    }))
    mocks.runRemoteLifecycleWrite.mockResolvedValue({
      kind: 'settled',
      lifecycle: { kind: 'ready' },
      name: 'repo',
      repoId: 'ssh-config://prod/srv/repo',
    })
  })

  test('restores server-owned workspace tabs only after strict validation succeeds', async () => {
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
      restoreTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
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
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      targets: [{ repoRoot: '/repo', branchName: 'main', worktreePath: '/repo' }],
    })
    expect(result.runtime).toMatchObject({
      restoredRepoId: '/repo',
      repos: [
        { entry: { kind: 'local', id: '/repo' }, repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test', name: 'repo' },
      ],
      workspacePaneTabs: [
        { repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test', snapshot: { revision: 1, entries: [] } },
      ],
    })
  })

  test('repairs instead of migrating non-canonical local workspace entries', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openRepoEntries: [{ kind: 'local', id: '/repo/src' }],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.probeRepo.mockResolvedValue({ ok: true, root: '/repo', name: 'repo' })
    const workspacePaneTabsHost = {
      restoreTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
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
    expect(result.openRepoEntries).toEqual([])
    expect(result.runtime.repos).toEqual([])
  })

  test('validates and projects workspace tabs into a canonical snapshot', async () => {
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
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(),
      restoreTabs: vi.fn(async () => ({ revision: 3, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('restored')
    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      targets: [{ repoRoot: '/repo', branchName: 'main', worktreePath: '/repo' }],
    })
    expect(result.runtime.workspacePaneTabs).toEqual([
      { repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test', snapshot: { revision: 3, entries: [] } },
    ])
  })

  test('keeps a canonical active local repo as a stub when projection is temporarily unavailable', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.readRepoProjection.mockResolvedValue({ snapshot: null })
    const workspacePaneTabsHost = {
      restoreTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
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
    expect(result.openRepoEntries).toEqual(workspace.openRepoEntries)
    expect(result.runtime.repos).toEqual([
      expect.objectContaining({ repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test', projection: null }),
    ])
    expect(mocks.releaseRepoRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('keeps a local repo declaration as a stub when its path is temporarily unavailable', async () => {
    const entry = { kind: 'local' as const, id: '/repo' }
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openRepoEntries: [entry],
    })
    mocks.probeRepo.mockResolvedValue({ ok: false, message: 'error.path-permission-denied' })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspace({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('restored')
    expect(result.openRepoEntries).toEqual([entry])
    expect(result.runtime.repos).toEqual([
      expect.objectContaining({ entry, repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test', projection: null }),
    ])
    expect(mocks.releaseRepoRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('keeps an active remote repo as a stub when lifecycle is temporarily unavailable', async () => {
    const remoteEntry = {
      kind: 'remote' as const,
      id: 'ssh-config://prod/srv/repo',
      ref: { id: 'ssh-config://prod/srv/repo', alias: 'prod', remotePath: '/srv/repo', displayName: 'repo' },
    }
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openRepoEntries: [remoteEntry],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.runRemoteLifecycleWrite.mockResolvedValue({
      kind: 'settled',
      lifecycle: { kind: 'failed', reason: 'unreachable' },
      name: 'repo',
    })
    const workspacePaneTabsHost = {
      restoreTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
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
    expect(result.openRepoEntries).toEqual(workspace.openRepoEntries)
    expect(result.runtime.repos).toEqual([expect.not.objectContaining({ target: expect.anything() })])
    expect(result.runtime.repos[0]).toMatchObject({
      repoRoot: remoteEntry.id,
      repoRuntimeId: 'repo-runtime-test',
      projection: null,
    })
    expect(mocks.releaseRepoRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('releases opened runtimes when workspace tab commit fails unexpectedly', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({ repoRoot: '/repo', branchName: 'main', worktreePath: null })
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      workspacePaneTabsByTargetByRepo: {
        '/repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
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
        userId: 'user-test',
        clientId: 'client_test000000000000',
        workspacePaneTabsHost,
      }),
    ).rejects.toBe(commitError)

    expect(mocks.releaseRepoRuntimeMembershipLease).toHaveBeenCalledWith('user-test', 'client_test000000000000', {
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      generation: 1,
    })
  })

  test('releases opened runtimes and skips tab commits when aborted after projection restore', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({ repoRoot: '/repo', branchName: 'main', worktreePath: null })
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      workspacePaneTabsByTargetByRepo: {
        '/repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
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
      restoreTabs: vi.fn(async () => ({ revision: 5, entries: [] })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    await expect(
      restoreServerWorkspace({
        userId: 'user-test',
        clientId: 'client_test000000000000',
        workspacePaneTabsHost,
        signal: controller.signal,
      }),
    ).rejects.toBe(abortReason)

    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
    expect(mocks.releaseRepoRuntimeMembershipLease).toHaveBeenCalledWith('user-test', 'client_test000000000000', {
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      generation: 1,
    })
  })

  test('releases the acquired remote runtime when remote lifecycle restore is aborted', async () => {
    const remoteEntry = {
      kind: 'remote' as const,
      id: 'ssh-config://prod/srv/repo',
      ref: { id: 'ssh-config://prod/srv/repo', alias: 'prod', remotePath: '/srv/repo', displayName: 'repo' },
    }
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openRepoEntries: [remoteEntry],
    }
    const controller = new AbortController()
    const abortReason = new Error('remote restore aborted')
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.runRemoteLifecycleWrite.mockImplementation(() => new Promise(() => {}))
    const workspacePaneTabsHost = {
      restoreTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    const restore = restoreServerWorkspace({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspacePaneTabsHost,
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(mocks.runRemoteLifecycleWrite).toHaveBeenCalled())
    controller.abort(abortReason)

    await expect(restore).rejects.toBe(abortReason)
    expect(mocks.releaseRepoRuntimeMembershipLease).toHaveBeenCalledOnce()
    expect(mocks.releaseRepoRuntimeMembershipLease).toHaveBeenCalledWith('user-test', 'client_test000000000000', {
      repoRoot: remoteEntry.id,
      repoRuntimeId: 'repo-runtime-test',
      generation: 1,
    })
  })

  test('releases opened runtimes when workspace repair persistence fails', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      repoRoot: '/repo',
      branchName: 'missing',
      worktreePath: null,
    })
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      workspacePaneTabsByTargetByRepo: {
        '/repo': { [targetKey]: [workspacePaneStaticTabEntry('files')] },
      },
    }
    const persistError = new Error('settings write failed')
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    const workspacePaneTabsHost = {
      restoreTabs: vi.fn(async () => { throw persistError }),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
    await expect(
      restoreServerWorkspace({
        userId: 'user-test',
        clientId: 'client_test000000000000',
        workspacePaneTabsHost,
      }),
    ).rejects.toBe(persistError)

    expect(mocks.releaseRepoRuntimeMembershipLease).toHaveBeenCalledWith('user-test', 'client_test000000000000', {
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      generation: 1,
    })
  })

  test('uses concurrently repaired repo tabs without overwriting them', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      repoRoot: '/repo',
      branchName: 'missing',
      worktreePath: null,
    })
    const otherTargetKey = workspacePaneTabsTargetIdentityKey({
      repoRoot: '/other',
      branchName: 'main',
      worktreePath: null,
    })
    const invalidWorkspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      workspacePaneTabsByTargetByRepo: {
        '/repo': { [targetKey]: [workspacePaneStaticTabEntry('files')] },
        '/other': { [otherTargetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    const currentWorkspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
    }
    mocks.getServerWorkspaceState.mockResolvedValueOnce(invalidWorkspace).mockResolvedValueOnce(currentWorkspace)
    mocks.compareAndReplaceServerWorkspaceRepos
      .mockResolvedValueOnce({ matched: true, workspace: invalidWorkspace })
      .mockResolvedValueOnce({ matched: true, workspace: currentWorkspace })
    const workspacePaneTabsHost = {
      restoreTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
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
    expect(mocks.releaseRepoRuntimeMembershipLease).not.toHaveBeenCalled()
  })
})
