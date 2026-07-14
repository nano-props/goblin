import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultWorkspaceSessionState } from '#/shared/settings-defaults.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspaceSessionState } from '#/shared/api-types.ts'

const mocks = vi.hoisted(() => ({
  acquireRepoRuntimeLease: vi.fn(),
  releaseRepoRuntimeMembershipLease: vi.fn(),
  isCurrentRepoRuntime: vi.fn(),
  getServerSessionState: vi.fn(),
  saveRebuiltServerSessionState: vi.fn(),
  probeRepo: vi.fn(),
  readRepoProjection: vi.fn(),
  runRemoteLifecycleWrite: vi.fn(),
}))

vi.mock('#/server/modules/repo-runtimes.ts', () => ({
  acquireRepoRuntimeLease: mocks.acquireRepoRuntimeLease,
  releaseRepoRuntimeMembershipLease: mocks.releaseRepoRuntimeMembershipLease,
  isCurrentRepoRuntime: mocks.isCurrentRepoRuntime,
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
    mocks.isCurrentRepoRuntime.mockReturnValue(true)
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

  test('rebuilds instead of migrating non-canonical local session entries', async () => {
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

    expect(result.status).toBe('rebuilt')
    expect(result.session).toEqual(defaultWorkspaceSessionState())
    expect(result.runtime.repos).toEqual([])
    expect(mocks.saveRebuiltServerSessionState).toHaveBeenCalledWith({
      persistedSnapshot: session,
      rebuiltSession: defaultWorkspaceSessionState(),
    })
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

describe('restoreServerWorkspaceSession — active-only restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.acquireRepoRuntimeLease.mockImplementation((_userId: string, repoRoot: string) => ({
      repoRoot,
      repoRuntimeId: `runtime-${repoRoot.replace(/[^a-z0-9]/gi, '_')}`,
      generation: 1,
    }))
    mocks.isCurrentRepoRuntime.mockReturnValue(true)
    mocks.probeRepo.mockImplementation(async (repoRoot: string) => ({ ok: true, root: repoRoot, name: 'repo' }))
    mocks.readRepoProjection.mockImplementation(async (repoRoot: string) => ({
      snapshot: { current: 'main', branches: [{ name: 'main', worktree: { path: repoRoot } }] },
      status: [],
      pullRequests: null,
      operations: { operations: [], loadedAt: 0 },
      requested: { branch: null, pullRequestMode: 'full' },
      loadedAt: 1,
    }))
    mocks.saveRebuiltServerSessionState.mockImplementation(async ({ rebuiltSession }: { rebuiltSession: WorkspaceSessionState }) => ({
      saved: true,
      session: rebuiltSession,
    }))
  })

  test('non-active repos are validated stubs — no projection read, projection: null', async () => {
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [
        { kind: 'local', id: '/repo-active' },
        { kind: 'local', id: '/repo-stub' },
      ],
      restoredRepoId: '/repo-active',
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
    // Stub repos do not contribute to the tabs restore.
    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
    expect(result.runtime.workspacePaneTabs).toEqual([])
  })

  test('uses activeRepoRoot instead of restoredRepoId to choose the eager restore repo', async () => {
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [
        { kind: 'local', id: '/repo-a' },
        { kind: 'local', id: '/repo-b' },
      ],
      restoredRepoId: '/repo-a',
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
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [
        { kind: 'local', id: '/repo-active' },
        { kind: 'local', id: '/repo-stub/src' },
      ],
      restoredRepoId: '/repo-active',
    }
    mocks.getServerSessionState.mockResolvedValue(session)
    mocks.probeRepo.mockImplementation(async (repoRoot: string) => ({
      ok: true,
      root: repoRoot === '/repo-stub/src' ? '/repo-stub' : repoRoot,
      name: 'repo',
    }))
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
    expect(result.runtime.repos).toEqual([])
    expect(mocks.readRepoProjection).toHaveBeenCalledTimes(1)
    expect(mocks.saveRebuiltServerSessionState).toHaveBeenCalledWith({
      persistedSnapshot: session,
      rebuiltSession: defaultWorkspaceSessionState(),
    })
  })

  test('non-active remote repos use their display name without opening remote lifecycle', async () => {
    const remoteEntry = {
      kind: 'remote' as const,
      id: 'ssh-config://prod/srv/repo',
      ref: {
        id: 'ssh-config://prod/srv/repo',
        alias: 'prod',
        remotePath: '/srv/repo',
        displayName: 'prod:repo',
      },
    }
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [
        { kind: 'local', id: '/repo-active' },
        remoteEntry,
      ],
      restoredRepoId: '/repo-active',
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
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [
        { kind: 'local', id: '/repo-active' },
        { kind: 'local', id: '/repo-stub' },
      ],
      restoredRepoId: '/repo-active',
      workspacePaneTabsByTargetByRepo: {
        // Stale tab entry for the stub repo that would normally force a
        // rebuild — but plan B skips validation for stubs.
        '/repo-stub': { [staleTargetKey]: [workspacePaneStaticTabEntry('history')] },
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
    expect(mocks.saveRebuiltServerSessionState).not.toHaveBeenCalled()
  })
})

describe('restoreRepoTabsForRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.acquireRepoRuntimeLease.mockImplementation((_userId: string, repoRoot: string) => ({
      repoRoot,
      repoRuntimeId: 'repo-runtime-test',
      generation: 1,
    }))
    mocks.isCurrentRepoRuntime.mockReturnValue(true)
    mocks.probeRepo.mockImplementation(async (repoRoot: string) => ({ ok: true, root: repoRoot, name: 'repo' }))
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
  })

  test('probes + projects + restores tabs for a single repo', async () => {
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
      replaceTabs: vi.fn(async () => ({ revision: 5, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreRepoTabsForRepo } = await import('#/server/modules/session-restore.ts')
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
    expect(workspacePaneTabsHost.replaceTabs).toHaveBeenCalledWith('client_test000000000000', 'user-test', {
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      branchName: 'main',
      worktreePath: null,
      tabs: [workspacePaneStaticTabEntry('history')],
    })
  })

  test('cleans invalid deferred tab state instead of silently skipping it', async () => {
    const staleTargetKey = workspacePaneTabsTargetIdentityKey({
      repoRoot: '/repo',
      branchName: 'deleted-branch',
      worktreePath: null,
    })
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
      zenMode: true,
      workspacePaneSize: 41,
      workspacePaneTabsByTargetByRepo: {
        '/repo': { [staleTargetKey]: [workspacePaneStaticTabEntry('history')] },
      },
      preferredWorkspacePaneTabByTargetByRepo: {
        '/repo': { [staleTargetKey]: 'history' },
      },
    }
    mocks.getServerSessionState.mockResolvedValue(session)
    const workspacePaneTabsHost = {
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 5, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreRepoTabsForRepo } = await import('#/server/modules/session-restore.ts')
    const result = await restoreRepoTabsForRepo({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      workspacePaneTabsHost,
    })

    expect(result.status).toBe('rebuilt')
    expect(result.snapshot).toBeNull()
    expect(result.repo.projection).not.toBeNull()
    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
    expect(mocks.saveRebuiltServerSessionState).toHaveBeenCalledWith({
      persistedSnapshot: session,
      rebuiltSession: {
        ...defaultWorkspaceSessionState(),
        openRepoEntries: [{ kind: 'local', id: '/repo' }],
        restoredRepoId: '/repo',
        zenMode: true,
        workspacePaneSize: 41,
      },
    })
  })

  test('throws repo-runtime-stale when clientId/repoRuntimeId does not match the active lease', async () => {
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
    }
    mocks.getServerSessionState.mockResolvedValue(session)
    mocks.isCurrentRepoRuntime.mockReturnValue(false)
    const workspacePaneTabsHost = {
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(),
      updateTabs: vi.fn(),
    }

    const { restoreRepoTabsForRepo } = await import('#/server/modules/session-restore.ts')
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

  test('throws repo-not-in-session when the requested repo is not in the saved session', async () => {
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/other' }],
      restoredRepoId: '/other',
    }
    mocks.getServerSessionState.mockResolvedValue(session)
    const workspacePaneTabsHost = {
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(),
      updateTabs: vi.fn(),
    }

    const { restoreRepoTabsForRepo } = await import('#/server/modules/session-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: '/repo',
        repoRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })
  })

})
