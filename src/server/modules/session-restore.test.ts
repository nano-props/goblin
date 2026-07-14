import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { ServerWorkspaceState } from '#/shared/api-types.ts'
import {
  defaultTestWorkspaceSessionState as defaultWorkspaceSessionState,
  type TestWorkspaceSessionState as WorkspaceSessionState,
} from '#/test-utils/workspace-session-state.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'

const mocks = vi.hoisted(() => ({
  acquireRepoRuntimeLease: vi.fn(),
  releaseRepoRuntimeMembershipLease: vi.fn(),
  isCurrentRepoRuntime: vi.fn(),
  getServerWorkspaceState: vi.fn(),
  replaceServerWorkspaceReposIfUnchanged: vi.fn(),
  clearServerWorkspaceTabsIfUnchanged: vi.fn(),
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
  getServerWorkspaceState: mocks.getServerWorkspaceState,
  replaceServerWorkspaceReposIfUnchanged: mocks.replaceServerWorkspaceReposIfUnchanged,
  clearServerWorkspaceTabsIfUnchanged: mocks.clearServerWorkspaceTabsIfUnchanged,
}))

vi.mock('#/server/modules/repo-read-paths.ts', () => ({
  probeRepo: mocks.probeRepo,
  readRepoProjection: mocks.readRepoProjection,
}))

vi.mock('#/server/modules/remote-lifecycle-write-paths.ts', () => ({
  runRemoteLifecycleWrite: mocks.runRemoteLifecycleWrite,
}))

function serverWorkspaceFromSession(session: WorkspaceSessionState): ServerWorkspaceState {
  return {
    openRepoEntries: session.openRepoEntries,
    workspacePaneTabsByTargetByRepo: session.workspacePaneTabsByTargetByRepo,
  }
}

describe('restoreServerWorkspace', () => {
  beforeEach(() => {
    vi.resetAllMocks()
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
    mocks.clearServerWorkspaceTabsIfUnchanged.mockImplementation(async ({ repoRoot }: { repoRoot: string }) => ({
      cleared: true,
      workspace: { openRepoEntries: [], workspacePaneTabsByTargetByRepo: {} },
    }))
    mocks.replaceServerWorkspaceReposIfUnchanged.mockImplementation(
      async (_expected: RepoSessionEntry[], replacement: RepoSessionEntry[]) => ({
        replaced: true,
        workspace: { openRepoEntries: replacement, workspacePaneTabsByTargetByRepo: {} },
      }),
    )
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
    mocks.getServerWorkspaceState.mockResolvedValue(serverWorkspaceFromSession(session))
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 1, entries: [] })),
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
    expect(result.runtime).toMatchObject({
      restoredRepoId: '/repo',
      repos: [
        { entry: { kind: 'local', id: '/repo' }, repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test', name: 'repo' },
      ],
      workspacePaneTabs: [
        { repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test', snapshot: { revision: 1, entries: [] } },
      ],
    })
    expect(mocks.clearServerWorkspaceTabsIfUnchanged).not.toHaveBeenCalled()
  })

  test('rebuilds instead of migrating non-canonical local session entries', async () => {
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo/src' }],
      restoredRepoId: '/repo/src',
    }
    mocks.getServerWorkspaceState.mockResolvedValue(serverWorkspaceFromSession(session))
    mocks.probeRepo.mockResolvedValue({ ok: true, root: '/repo', name: 'repo' })
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
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
    expect(result.workspace).toEqual(defaultServerWorkspaceState())
    expect(result.openRepoEntries).toEqual([])
    expect(result.runtime.repos).toEqual([])
    expect(mocks.clearServerWorkspaceTabsIfUnchanged).not.toHaveBeenCalled()
  })

  test('initializes the workspace tabs scope and returns its canonical snapshot', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({ repoRoot: '/repo', branchName: 'main', worktreePath: null })
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
      workspacePaneTabsByTargetByRepo: {
        '/repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    mocks.getServerWorkspaceState.mockResolvedValue(serverWorkspaceFromSession(session))
    const workspacePaneTabsHost = {
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(),
      initializeTabs: vi.fn(async () => ({ revision: 3, entries: [] })),
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
    expect(result.runtime.workspacePaneTabs).toEqual([
      { repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test', snapshot: { revision: 3, entries: [] } },
    ])
  })

  test('keeps a canonical active local repo as a stub when projection is temporarily unavailable', async () => {
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
    }
    mocks.getServerWorkspaceState.mockResolvedValue(serverWorkspaceFromSession(session))
    mocks.readRepoProjection.mockResolvedValue({ snapshot: null })
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
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
    expect(result.workspace).toEqual(serverWorkspaceFromSession(session))
    expect(result.openRepoEntries).toEqual(session.openRepoEntries)
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
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(),
      updateTabs: vi.fn(),
    }

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
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [remoteEntry],
      restoredRepoId: remoteEntry.id,
    }
    mocks.getServerWorkspaceState.mockResolvedValue(serverWorkspaceFromSession(session))
    mocks.runRemoteLifecycleWrite.mockResolvedValue({
      kind: 'settled',
      lifecycle: { kind: 'failed', reason: 'unreachable' },
      name: 'repo',
    })
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
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
    expect(result.workspace).toEqual(serverWorkspaceFromSession(session))
    expect(result.openRepoEntries).toEqual(session.openRepoEntries)
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
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
      workspacePaneTabsByTargetByRepo: {
        '/repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    mocks.getServerWorkspaceState.mockResolvedValue(serverWorkspaceFromSession(session))
    const commitError = new Error('commit failed')
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => {
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
    mocks.getServerWorkspaceState.mockResolvedValue(serverWorkspaceFromSession(session))
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
      initializeTabs: vi.fn(async () => ({ revision: 5, entries: [] })),
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
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [remoteEntry],
      restoredRepoId: remoteEntry.id,
    }
    const controller = new AbortController()
    const abortReason = new Error('remote restore aborted')
    mocks.getServerWorkspaceState.mockResolvedValue(serverWorkspaceFromSession(session))
    mocks.runRemoteLifecycleWrite.mockImplementation(() => new Promise(() => {}))
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
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
    expect(mocks.releaseRepoRuntimeMembershipLease).toHaveBeenCalledWith('user-test', 'client_test000000000000', {
      repoRoot: remoteEntry.id,
      repoRuntimeId: 'repo-runtime-test',
      generation: 1,
    })
  })

  test('releases opened runtimes when clean session rebuild persistence fails', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      repoRoot: '/repo',
      branchName: 'missing',
      worktreePath: null,
    })
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
      workspacePaneTabsByTargetByRepo: {
        '/repo': { [targetKey]: [workspacePaneStaticTabEntry('files')] },
      },
    }
    const persistError = new Error('settings write failed')
    mocks.getServerWorkspaceState.mockResolvedValue(serverWorkspaceFromSession(session))
    mocks.clearServerWorkspaceTabsIfUnchanged.mockRejectedValue(persistError)
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
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
    const invalidSession: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
      workspacePaneTabsByTargetByRepo: {
        '/repo': { [targetKey]: [workspacePaneStaticTabEntry('files')] },
        '/other': { [otherTargetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    const currentSession: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
      workspacePaneSize: 333,
    }
    mocks.getServerWorkspaceState
      .mockResolvedValueOnce(serverWorkspaceFromSession(invalidSession))
      .mockResolvedValueOnce(serverWorkspaceFromSession(currentSession))
    mocks.clearServerWorkspaceTabsIfUnchanged.mockResolvedValueOnce({
      cleared: false,
      latestWorkspace: serverWorkspaceFromSession(currentSession),
    })
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
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

    expect(result).toMatchObject({ status: 'restored', workspace: serverWorkspaceFromSession(currentSession) })
    expect(mocks.clearServerWorkspaceTabsIfUnchanged).toHaveBeenCalledTimes(1)
    expect(mocks.clearServerWorkspaceTabsIfUnchanged).toHaveBeenCalledWith({
      repoRoot: '/repo',
      expectedTabsByTarget: {
        [targetKey]: [workspacePaneStaticTabEntry('files')],
      },
    })
    expect(mocks.releaseRepoRuntimeMembershipLease).not.toHaveBeenCalled()
  })
})

describe('restoreServerWorkspace — active-only restore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
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
    mocks.clearServerWorkspaceTabsIfUnchanged.mockResolvedValue({
      cleared: true,
      workspace: defaultServerWorkspaceState(),
    })
    mocks.replaceServerWorkspaceReposIfUnchanged.mockImplementation(
      async (_expected: RepoSessionEntry[], replacement: RepoSessionEntry[]) => ({
        replaced: true,
        workspace: { openRepoEntries: replacement, workspacePaneTabsByTargetByRepo: {} },
      }),
    )
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
    mocks.getServerWorkspaceState.mockResolvedValue(serverWorkspaceFromSession(session))
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
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

  test('uses activeRepoRoot instead of restoredRepoId to choose the eager restore repo', async () => {
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [
        { kind: 'local', id: '/repo-a' },
        { kind: 'local', id: '/repo-b' },
      ],
      restoredRepoId: '/repo-a',
    }
    mocks.getServerWorkspaceState.mockResolvedValue(serverWorkspaceFromSession(session))
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 5, entries: [] })),
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
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [
        { kind: 'local', id: '/repo-active' },
        { kind: 'local', id: '/repo-stub/src' },
      ],
      restoredRepoId: '/repo-active',
    }
    mocks.getServerWorkspaceState.mockResolvedValue(serverWorkspaceFromSession(session))
    mocks.probeRepo.mockImplementation(async (repoRoot: string) => ({
      ok: true,
      root: repoRoot === '/repo-stub/src' ? '/repo-stub' : repoRoot,
      name: 'repo',
    }))
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
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
    expect(result.workspace.openRepoEntries).toEqual([{ kind: 'local', id: '/repo-active' }])
    expect(result.openRepoEntries).toEqual([{ kind: 'local', id: '/repo-active' }])
    expect(result.runtime.repos).toHaveLength(1)
    expect(result.runtime.repos[0]).toMatchObject({ repoRoot: '/repo-active' })
    expect(mocks.readRepoProjection).toHaveBeenCalledTimes(1)
    expect(mocks.clearServerWorkspaceTabsIfUnchanged).not.toHaveBeenCalled()
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
      openRepoEntries: [{ kind: 'local', id: '/repo-active' }, remoteEntry],
      restoredRepoId: '/repo-active',
    }
    mocks.getServerWorkspaceState.mockResolvedValue(serverWorkspaceFromSession(session))
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
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
    mocks.getServerWorkspaceState.mockResolvedValue(serverWorkspaceFromSession(session))
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
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
    expect(mocks.clearServerWorkspaceTabsIfUnchanged).not.toHaveBeenCalled()
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
    mocks.clearServerWorkspaceTabsIfUnchanged.mockResolvedValue({
      cleared: true,
      workspace: { workspacePaneTabsByTargetByRepo: {} },
    })
  })

  function restoreEntry(entry: RepoSessionEntry): RepoSessionEntry {
    return entry
  }

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
    mocks.getServerWorkspaceState.mockResolvedValue(serverWorkspaceFromSession(session))
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 5, entries: [] })),
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
      entry: restoreEntry({ kind: 'local', id: '/repo' }),
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
    mocks.getServerWorkspaceState.mockResolvedValue(serverWorkspaceFromSession(session))
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
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
      entry: restoreEntry({ kind: 'local', id: '/repo' }),
      workspacePaneTabsHost,
    })

    expect(result.snapshot).toEqual({ revision: 0, entries: [] })
    expect(result.repo.projection).not.toBeNull()
    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
    expect(mocks.clearServerWorkspaceTabsIfUnchanged).toHaveBeenCalledWith({
      repoRoot: '/repo',
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
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
    }
    mocks.getServerWorkspaceState.mockResolvedValue(serverWorkspaceFromSession(session))
    mocks.isCurrentRepoRuntime.mockReturnValue(false)
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
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
        entry: restoreEntry({ kind: 'local', id: '/repo' }),
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'error.repo-runtime-stale' })
    expect(mocks.probeRepo).not.toHaveBeenCalled()
  })

  test('restores client-owned repo membership using current server-owned tabs', async () => {
    const session: WorkspaceSessionState = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/other' }],
      restoredRepoId: '/other',
    }
    mocks.getServerWorkspaceState.mockResolvedValue(serverWorkspaceFromSession(session))
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
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
        entry: restoreEntry({ kind: 'local', id: '/repo' }),
        workspacePaneTabsHost,
      }),
    ).resolves.toMatchObject({ repo: { repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test' } })
    expect(mocks.getServerWorkspaceState).toHaveBeenCalledOnce()
  })

  test('keeps the existing membership when lazy local projection fails', async () => {
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
    })
    mocks.readRepoProjection.mockResolvedValue({ snapshot: null })
    const workspacePaneTabsHost = {
      initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
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
        entry: restoreEntry({ kind: 'local', id: '/repo' }),
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
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [remoteEntry],
      restoredRepoId: remoteEntry.id,
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

    const { restoreRepoTabsForRepo } = await import('#/server/modules/session-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: remoteEntry.id,
        repoRuntimeId: 'repo-runtime-test',
        entry: restoreEntry(remoteEntry),
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'error.failed-read-repo' })
    expect(mocks.acquireRepoRuntimeLease).not.toHaveBeenCalled()
    expect(mocks.releaseRepoRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('rejects a projection if the membership becomes stale while reading', async () => {
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local', id: '/repo' }],
      restoredRepoId: '/repo',
    })
    mocks.isCurrentRepoRuntime
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

    const { restoreRepoTabsForRepo } = await import('#/server/modules/session-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: '/repo',
        repoRuntimeId: 'repo-runtime-test',
        entry: restoreEntry({ kind: 'local', id: '/repo' }),
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'error.repo-runtime-stale' })
    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
  })
})
