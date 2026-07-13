import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultWorkspaceSessionState } from '#/shared/settings-defaults.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspaceSessionState } from '#/shared/api-types.ts'

const mocks = vi.hoisted(() => ({
  acquireRepoRuntimeLease: vi.fn(),
  releaseRepoRuntimeMembershipLease: vi.fn(),
  getServerSessionState: vi.fn(),
  saveRebuiltServerSessionState: vi.fn(),
  probeRepo: vi.fn(),
  readRepoProjection: vi.fn(),
  runRemoteLifecycleWrite: vi.fn(),
}))

vi.mock('#/server/modules/repo-runtimes.ts', () => ({
  acquireRepoRuntimeLease: mocks.acquireRepoRuntimeLease,
  releaseRepoRuntimeMembershipLease: mocks.releaseRepoRuntimeMembershipLease,
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerSessionState: mocks.getServerSessionState,
  saveRebuiltServerSessionState: mocks.saveRebuiltServerSessionState,
}))

vi.mock('#/server/modules/repo-read-paths.ts', () => ({
  probeRepo: mocks.probeRepo,
  readRepoProjection: mocks.readRepoProjection,
}))

vi.mock('#/server/modules/remote-lifecycle-write-paths.ts', () => ({
  runRemoteLifecycleWrite: mocks.runRemoteLifecycleWrite,
}))

describe('restoreServerWorkspaceSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.acquireRepoRuntimeLease.mockImplementation((_userId: string, repoRoot: string) => ({
      repoRoot,
      repoRuntimeId: 'repo-runtime-test',
      generation: 1,
    }))
    mocks.probeRepo.mockResolvedValue({ ok: true, root: '/repo', name: 'repo' })
    mocks.readRepoProjection.mockResolvedValue({
      snapshot: { current: 'main', branches: [{ name: 'main', worktree: { path: '/repo' } }] },
      status: [],
      pullRequests: null,
      operations: { operations: [], loadedAt: 0 },
      requested: { branch: null, pullRequestMode: 'full' },
      loadedAt: 1,
    })
    mocks.saveRebuiltServerSessionState.mockImplementation(async ({ rebuiltSession }: { rebuiltSession: WorkspaceSessionState }) => ({
      saved: true,
      session: rebuiltSession,
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
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
      workspacePaneTabsByTargetByRepo: {
        '/repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
      preferredWorkspacePaneTabByTargetByRepo: {
        '/repo': { [targetKey]: 'history' },
      },
    }
    mocks.getServerSessionState.mockResolvedValue(session)
    const workspacePaneTabsHost = {
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspaceSession } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspaceSession({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('restored')
    expect(workspacePaneTabsHost.replaceTabs).toHaveBeenCalledWith('client_test000000000000', 'user-test', {
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      branchName: 'main',
      worktreePath: null,
      tabs: [workspacePaneStaticTabEntry('history')],
    })
    expect(result.runtime).toMatchObject({
      restoredRepoId: '/repo',
      repos: [{ entry: { kind: 'local', id: '/repo' }, repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test', name: 'repo' }],
      workspacePaneTabs: [{ repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test', snapshot: { revision: 1, entries: [] } }],
    })
    expect(mocks.saveRebuiltServerSessionState).not.toHaveBeenCalled()
  })

  test('returns canonical repo roots for local session inputs restored from subdirectories', async () => {
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo/src' }],
      restoredRepoId: '/repo/src',
    }
    mocks.getServerSessionState.mockResolvedValue(session)
    mocks.probeRepo.mockResolvedValue({ ok: true, root: '/repo', name: 'repo' })
    const workspacePaneTabsHost = {
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspaceSession } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspaceSession({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('restored')
    expect(result.session.openRepoEntries).toEqual([{ kind: 'local', id: '/repo' }])
    expect(result.session.restoredRepoId).toBe('/repo')
    expect(result.runtime.restoredRepoId).toBe('/repo')
    expect(result.runtime.repos).toMatchObject([{ entry: { kind: 'local', id: '/repo' }, repoRoot: '/repo' }])
    expect(mocks.saveRebuiltServerSessionState).not.toHaveBeenCalled()
  })

  test('uses the workspace tabs batch host and returns canonical tab snapshots', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({ repoRoot: '/repo', branchName: 'main', worktreePath: null })
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
      workspacePaneTabsByTargetByRepo: {
        '/repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    mocks.getServerSessionState.mockResolvedValue(session)
    const workspacePaneTabsHost = {
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(),
      replaceTabsBatch: vi.fn(async () => [
        { repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test', snapshot: { revision: 3, entries: [] } },
      ]),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspaceSession } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspaceSession({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('restored')
    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
    expect(workspacePaneTabsHost.replaceTabsBatch).toHaveBeenCalledWith('client_test000000000000', 'user-test', {
      replacements: [
        {
          repoRoot: '/repo',
          repoRuntimeId: 'repo-runtime-test',
          branchName: 'main',
          worktreePath: null,
          tabs: [workspacePaneStaticTabEntry('history')],
        },
      ],
    })
    expect(result.runtime.workspacePaneTabs).toEqual([
      { repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test', snapshot: { revision: 3, entries: [] } },
    ])
  })

  test('rebuilds clean session without committing tabs when preferred state violates invariants', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({ repoRoot: '/repo', branchName: 'main', worktreePath: null })
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
      zenMode: true,
      workspacePaneSize: 420,
      workspacePaneTabsByTargetByRepo: {
        '/repo': { [targetKey]: [workspacePaneStaticTabEntry('status')] },
      },
      preferredWorkspacePaneTabByTargetByRepo: {
        '/repo': { [targetKey]: 'files' },
      },
    }
    mocks.getServerSessionState.mockResolvedValue(session)
    const workspacePaneTabsHost = {
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspaceSession } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspaceSession({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('rebuilt')
    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
    expect(mocks.saveRebuiltServerSessionState).toHaveBeenCalledWith({
      persistedSnapshot: session,
      rebuiltSession: {
        ...defaultWorkspaceSessionState(),
        openRepoEntries: [{ kind: 'local', id: '/repo' }],
        restoredRepoId: '/repo',
        zenMode: true,
        workspacePaneSize: 420,
      },
    })
    expect(mocks.releaseRepoRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('releases the acquired local runtime when projection restore fails before membership settles', async () => {
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
    }
    mocks.getServerSessionState.mockResolvedValue(session)
    mocks.readRepoProjection.mockResolvedValue({ snapshot: null })
    const workspacePaneTabsHost = {
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspaceSession } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspaceSession({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('rebuilt')
    expect(result.session).toEqual(defaultWorkspaceSessionState())
    expect(mocks.releaseRepoRuntimeMembershipLease).toHaveBeenCalledWith('user-test', 'client_test000000000000', { repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test', generation: 1 })
  })

  test('releases the acquired remote runtime when lifecycle restore fails before membership settles', async () => {
    const remoteEntry = {
      kind: 'remote' as const,
      id: 'ssh-config://prod/srv/repo',
      ref: { id: 'ssh-config://prod/srv/repo', alias: 'prod', remotePath: '/srv/repo', displayName: 'repo' },
    }
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [remoteEntry],
      restoredRepoId: remoteEntry.id,
    }
    mocks.getServerSessionState.mockResolvedValue(session)
    mocks.runRemoteLifecycleWrite.mockResolvedValue({ kind: 'settled', lifecycle: { kind: 'failed', reason: 'unreachable' } })
    const workspacePaneTabsHost = {
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspaceSession } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspaceSession({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('rebuilt')
    expect(result.session).toEqual(defaultWorkspaceSessionState())
    expect(mocks.releaseRepoRuntimeMembershipLease).toHaveBeenCalledWith('user-test', 'client_test000000000000', {
      repoRoot: remoteEntry.id,
      repoRuntimeId: 'repo-runtime-test',
      generation: 1,
    })
  })

  test('releases opened runtimes when workspace tab commit fails unexpectedly', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({ repoRoot: '/repo', branchName: 'main', worktreePath: null })
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
      workspacePaneTabsByTargetByRepo: {
        '/repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    mocks.getServerSessionState.mockResolvedValue(session)
    const commitError = new Error('commit failed')
    const workspacePaneTabsHost = {
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => {
        throw commitError
      }),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspaceSession } = await import('#/server/modules/session-restore.ts')
    await expect(
      restoreServerWorkspaceSession({
        userId: 'user-test',
        clientId: 'client_test000000000000',
        workspacePaneTabsHost,
      }),
    ).rejects.toBe(commitError)

    expect(mocks.releaseRepoRuntimeMembershipLease).toHaveBeenCalledWith('user-test', 'client_test000000000000', { repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test', generation: 1 })
  })

  test('releases opened runtimes and skips tab commits when aborted after projection restore', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({ repoRoot: '/repo', branchName: 'main', worktreePath: null })
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
      workspacePaneTabsByTargetByRepo: {
        '/repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    const controller = new AbortController()
    const abortReason = new Error('request aborted')
    mocks.getServerSessionState.mockResolvedValue(session)
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
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspaceSession } = await import('#/server/modules/session-restore.ts')
    await expect(
      restoreServerWorkspaceSession({
        userId: 'user-test',
        clientId: 'client_test000000000000',
        workspacePaneTabsHost,
        signal: controller.signal,
      }),
    ).rejects.toBe(abortReason)

    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
    expect(mocks.releaseRepoRuntimeMembershipLease).toHaveBeenCalledWith('user-test', 'client_test000000000000', { repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test', generation: 1 })
  })

  test('releases the acquired remote runtime when remote lifecycle restore is aborted', async () => {
    const remoteEntry = {
      kind: 'remote' as const,
      id: 'ssh-config://prod/srv/repo',
      ref: { id: 'ssh-config://prod/srv/repo', alias: 'prod', remotePath: '/srv/repo', displayName: 'repo' },
    }
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [remoteEntry],
      restoredRepoId: remoteEntry.id,
    }
    const controller = new AbortController()
    const abortReason = new Error('remote restore aborted')
    mocks.getServerSessionState.mockResolvedValue(session)
    mocks.runRemoteLifecycleWrite.mockImplementation(() => new Promise(() => {}))
    const workspacePaneTabsHost = {
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspaceSession } = await import('#/server/modules/session-restore.ts')
    const restore = restoreServerWorkspaceSession({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspacePaneTabsHost,
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(mocks.runRemoteLifecycleWrite).toHaveBeenCalled())
    controller.abort(abortReason)

    await expect(restore).rejects.toBe(abortReason)
    expect(mocks.releaseRepoRuntimeMembershipLease).toHaveBeenCalledWith('user-test', 'client_test000000000000', {
      repoRoot: remoteEntry.id,
      repoRuntimeId: 'repo-runtime-test',
      generation: 1,
    })
  })

  test('releases opened runtimes when clean session rebuild persistence fails', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({ repoRoot: '/repo', branchName: 'main', worktreePath: null })
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
      preferredWorkspacePaneTabByTargetByRepo: {
        '/repo': { [targetKey]: 'files' },
      },
    }
    const persistError = new Error('settings write failed')
    mocks.getServerSessionState.mockResolvedValue(session)
    mocks.saveRebuiltServerSessionState.mockRejectedValue(persistError)
    const workspacePaneTabsHost = {
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspaceSession } = await import('#/server/modules/session-restore.ts')
    await expect(
      restoreServerWorkspaceSession({
        userId: 'user-test',
        clientId: 'client_test000000000000',
        workspacePaneTabsHost,
      }),
    ).rejects.toBe(persistError)

    expect(mocks.releaseRepoRuntimeMembershipLease).toHaveBeenCalledWith('user-test', 'client_test000000000000', { repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test', generation: 1 })
  })

  test('does not overwrite a concurrently changed session when rebuilding invalid persisted state', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({ repoRoot: '/repo', branchName: 'main', worktreePath: null })
    const invalidSession: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
      preferredWorkspacePaneTabByTargetByRepo: {
        '/repo': { [targetKey]: 'files' },
      },
    }
    const currentSession: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
      workspacePaneSize: 333,
    }
    mocks.getServerSessionState.mockResolvedValueOnce(invalidSession).mockResolvedValueOnce(currentSession)
    mocks.saveRebuiltServerSessionState.mockResolvedValueOnce({ saved: false, latestSession: currentSession })
    const workspacePaneTabsHost = {
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreServerWorkspaceSession } = await import('#/server/modules/session-restore.ts')
    const result = await restoreServerWorkspaceSession({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspacePaneTabsHost,
    })

    expect(result).toMatchObject({ status: 'restored', session: currentSession })
    expect(mocks.saveRebuiltServerSessionState).toHaveBeenCalledTimes(1)
    expect(mocks.releaseRepoRuntimeMembershipLease).toHaveBeenCalledWith('user-test', 'client_test000000000000', { repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test', generation: 1 })
  })
})
