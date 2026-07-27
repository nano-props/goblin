import { describe, expect, test, vi } from 'vitest'
import type { RemoteWorkspaceTarget } from '#/shared/api-types.ts'
import { normalizeRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import {
  LINKED_REPO_ID,
  REPO_ID,
  deferred,
  expectNoRepoSnapshotInvalidations,
  expectRepoSnapshotInvalidations,
  mocks,
  removeLocalRepoWorktreeForTest,
} from '#/server/test-utils/repo-module.ts'

describe('fetchRepo canonical boundaries', () => {
  test('does not execute fetch when affected-worktree discovery fails', async () => {
    mocks.getWorktrees.mockRejectedValueOnce(new Error('worktree discovery failed'))

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')

    await expect(fetchRepo(REPO_ID, 'user')).rejects.toThrow('worktree discovery failed')
    expect(mocks.fetchAll).not.toHaveBeenCalled()
    expectNoRepoSnapshotInvalidations()
  })

  test('does not execute remote fetch when affected-worktree discovery fails', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    mocks.getRemoteRepoWorktreePaths.mockRejectedValueOnce(new Error('remote worktree discovery failed'))

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')

    await expect(fetchRepo(repoId, 'user')).rejects.toThrow('remote worktree discovery failed')
    expect(mocks.fetchRemoteRepo).not.toHaveBeenCalled()
    expectNoRepoSnapshotInvalidations()
  })

  test.each([
    ['user', 'user'],
    ['background', 'background'],
  ])('%s sync fetches prune stale remote-tracking refs', async (_name, kind) => {
    mocks.fetchAll.mockResolvedValueOnce({ ok: true, message: 'fetched' })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepo(REPO_ID, kind as 'user' | 'background')

    expect(result).toEqual({ ok: true, message: 'fetched' })
    expect(mocks.fetchAll).toHaveBeenCalledWith('/tmp/repo', expect.any(AbortSignal))
  })

  test('merges caller abort signal into fetch operations', async () => {
    const caller = new AbortController()
    mocks.fetchAll.mockImplementationOnce(async (_cwd: string, signal?: AbortSignal) => {
      expect(signal?.aborted).toBe(false)
      caller.abort('stopped')
      expect(signal?.aborted).toBe(true)
      return { ok: false, message: 'cancelled' }
    })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepo(REPO_ID, 'user', caller.signal)

    expect(result).toEqual({ ok: false, message: 'cancelled' })
    expectNoRepoSnapshotInvalidations()
  })

  test('publishes snapshot invalidation after a successful sync', async () => {
    mocks.fetchAll.mockResolvedValueOnce({ ok: true, message: 'fetched' })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepo(REPO_ID, 'user')

    expect(result).toEqual({ ok: true, message: 'fetched' })
    expectRepoSnapshotInvalidations({
      repoId: REPO_ID,
      query: 'repo-snapshot',
    })
  })

  test('shares successful fetch time across worktrees with one write boundary', async () => {
    mocks.resolveRepoCommonDir.mockResolvedValue('/tmp/repo/.git')
    mocks.fetchAll.mockResolvedValueOnce({ ok: true, message: 'fetched' })
    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')

    await fetchRepo(REPO_ID, 'user', undefined, 'workspace-runtime-a')

    const primary = await readRepoOperationsSnapshot(REPO_ID, { workspaceRuntimeId: 'workspace-runtime-a' })
    const linked = await readRepoOperationsSnapshot(LINKED_REPO_ID, { workspaceRuntimeId: 'workspace-runtime-b' })
    expect(primary.lastFetchAt).toEqual(expect.any(Number))
    expect(linked.lastFetchAt).toBe(primary.lastFetchAt)
  })

  test('publishes sibling worktree snapshot invalidations after a successful sync', async () => {
    mocks.getWorktrees.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true, isDirty: false },
      { path: '/tmp/repo-linked', branch: 'feature/a', isBare: false, isPrimary: false, isDirty: false },
    ])
    mocks.fetchAll.mockResolvedValueOnce({ ok: true, message: 'fetched' })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepo(REPO_ID, 'user')

    expect(result).toEqual({ ok: true, message: 'fetched' })
    expectRepoSnapshotInvalidations(
      {
        repoId: REPO_ID,
        query: 'repo-snapshot',
      },
      {
        repoId: LINKED_REPO_ID,
        query: 'repo-snapshot',
      },
    )
  })

  test('user sync waits for an active sibling worktree background sync before fetching', async () => {
    mocks.resolveRepoCommonDir.mockImplementation(async (cwd: string) =>
      cwd === '/tmp/repo' || cwd === '/tmp/repo-linked' ? '/tmp/repo/.git' : `${cwd}/.git`,
    )
    mocks.getWorktrees.mockResolvedValue([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true, isDirty: false },
      { path: '/tmp/repo-linked', branch: 'feature/a', isBare: false, isPrimary: false, isDirty: false },
    ])
    const fetch = deferred<{ ok: true; message: string }>()
    mocks.fetchAll.mockImplementationOnce(() => fetch.promise)
    mocks.fetchAll.mockResolvedValueOnce({ ok: true, message: 'fetched by user' })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const background = fetchRepo(REPO_ID, 'background')
    await vi.waitFor(() => {
      expect(mocks.fetchAll).toHaveBeenCalledTimes(1)
    })
    const user = fetchRepo(LINKED_REPO_ID, 'user')

    fetch.resolve({ ok: true, message: 'fetched in background' })
    const [backgroundResult, userResult] = await Promise.all([background, user])

    expect(backgroundResult).toEqual({ ok: true, message: 'fetched in background' })
    expect(userResult).toEqual({ ok: true, message: 'fetched by user' })
    expect(mocks.fetchAll).toHaveBeenCalledTimes(2)
    expectRepoSnapshotInvalidations(
      {
        repoId: REPO_ID,
        query: 'repo-snapshot',
      },
      {
        repoId: LINKED_REPO_ID,
        query: 'repo-snapshot',
      },
      {
        repoId: LINKED_REPO_ID,
        query: 'repo-snapshot',
      },
      {
        repoId: REPO_ID,
        query: 'repo-snapshot',
      },
    )
  })

  test('user sync waits for an active remote background sync with the same alias', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const linkedRepoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo-linked' })
    mocks.getRemoteRepoWorktreePaths.mockResolvedValue(['/srv/repo', '/srv/repo-linked'])
    const fetch = deferred<{ ok: true; message: string }>()
    mocks.fetchRemoteRepo.mockImplementationOnce(async () => await fetch.promise)
    mocks.fetchRemoteRepo.mockResolvedValueOnce({ ok: true, message: 'fetched by user' })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const background = fetchRepo(repoId, 'background')
    await vi.waitFor(() => {
      expect(mocks.fetchRemoteRepo).toHaveBeenCalledTimes(1)
    })
    const user = fetchRepo(linkedRepoId, 'user')

    fetch.resolve({ ok: true, message: 'fetched in background' })
    const [backgroundResult, userResult] = await Promise.all([background, user])

    expect(backgroundResult).toEqual({ ok: true, message: 'fetched in background' })
    expect(userResult).toEqual({ ok: true, message: 'fetched by user' })
    expect(mocks.fetchRemoteRepo).toHaveBeenCalledTimes(2)
    expectRepoSnapshotInvalidations(
      {
        repoId,
        query: 'repo-snapshot',
      },
      {
        repoId: linkedRepoId,
        query: 'repo-snapshot',
      },
      {
        repoId: linkedRepoId,
        query: 'repo-snapshot',
      },
      {
        repoId,
        query: 'repo-snapshot',
      },
    )
  })

  test('fast-fails a queued remote write when its captured target changes', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    let host = 'host-a.example'
    mocks.resolveRemoteTarget.mockImplementation(async () => ({
      target: {
        id: repoId,
        alias: 'prod',
        host,
        user: 'deploy',
        port: 22,
        remotePath: '/srv/repo',
        displayName: 'prod:repo',
      },
    }))
    const activeFetch = deferred<{ ok: true; message: string }>()
    mocks.fetchRemoteRepo.mockImplementationOnce(async () => await activeFetch.promise)
    mocks.fetchRemoteRepo.mockResolvedValue({ ok: true, message: 'fetched current target' })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const active = fetchRepo(repoId, 'background')
    await vi.waitFor(() => expect(mocks.fetchRemoteRepo).toHaveBeenCalledTimes(1))
    const stale = fetchRepo(repoId, 'user')
    await vi.waitFor(() => expect(mocks.resolveRemoteTarget).toHaveBeenCalledTimes(3))

    host = 'host-b.example'
    const current = fetchRepo(repoId, 'user')
    activeFetch.resolve({ ok: true, message: 'fetched original target' })

    await expect(active).resolves.toEqual({ ok: true, message: 'fetched original target' })
    await expect(stale).resolves.toEqual({ ok: false, message: 'error.repository-target-changed' })
    await expect(current).resolves.toEqual({ ok: true, message: 'fetched current target' })
    expect(mocks.fetchRemoteRepo).toHaveBeenCalledTimes(2)
    expect(mocks.fetchRemoteRepo.mock.calls[0]?.[0]).toMatchObject({ host: 'host-a.example' })
    expect(mocks.fetchRemoteRepo.mock.calls[1]?.[0]).toMatchObject({ host: 'host-b.example' })
  })

  test('does not admit a remote write without a confirmed canonical boundary', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    mocks.resolveRemoteRepoExecutionIdentity.mockResolvedValue(null)

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    await expect(fetchRepo(repoId, 'user')).rejects.toThrow('error.repository-boundary-unavailable')
    expect(mocks.fetchRemoteRepo).not.toHaveBeenCalled()
  })

  test('does not admit a local write without a confirmed canonical boundary', async () => {
    mocks.resolveRepoCommonDir.mockRejectedValueOnce(new Error('git unavailable'))

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    await expect(fetchRepo(REPO_ID, 'user')).rejects.toThrow('error.repository-boundary-unavailable')
    expect(mocks.fetchAll).not.toHaveBeenCalled()
  })

  test('fast-fails when a local locator changes its canonical execution root', async () => {
    mocks.fsRealpath.mockResolvedValueOnce('/physical/repo-a').mockResolvedValueOnce('/physical/repo-b')
    mocks.resolveRepoCommonDir.mockResolvedValue('/physical/shared/.git')

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    await expect(fetchRepo(REPO_ID, 'user')).resolves.toEqual({
      ok: false,
      message: 'error.repository-target-changed',
    })
    expect(mocks.fetchAll).not.toHaveBeenCalled()
  })

  test('fast-fails when a local common directory is replaced at the same canonical path', async () => {
    mocks.fsStat
      .mockResolvedValueOnce({ isDirectory: () => true, dev: 1n, ino: 10n })
      .mockResolvedValueOnce({ isDirectory: () => true, dev: 1n, ino: 20n })
      .mockResolvedValueOnce({ isDirectory: () => true, dev: 1n, ino: 11n })
      .mockResolvedValueOnce({ isDirectory: () => true, dev: 1n, ino: 20n })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    await expect(fetchRepo(REPO_ID, 'user')).resolves.toEqual({
      ok: false,
      message: 'error.repository-target-changed',
    })
    expect(mocks.fetchAll).not.toHaveBeenCalled()
  })

  test('fast-fails when a local object store is recreated inside the retained common directory', async () => {
    mocks.fsStat
      .mockResolvedValueOnce({ isDirectory: () => true, dev: 1n, ino: 10n })
      .mockResolvedValueOnce({ isDirectory: () => true, dev: 1n, ino: 20n })
      .mockResolvedValueOnce({ isDirectory: () => true, dev: 1n, ino: 10n })
      .mockResolvedValueOnce({ isDirectory: () => true, dev: 1n, ino: 21n })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    await expect(fetchRepo(REPO_ID, 'user')).resolves.toEqual({
      ok: false,
      message: 'error.repository-target-changed',
    })
    expect(mocks.fsStat).toHaveBeenNthCalledWith(1, '/tmp/repo/.git', { bigint: true })
    expect(mocks.fsStat).toHaveBeenNthCalledWith(2, '/tmp/repo/.git/objects', { bigint: true })
    expect(mocks.fsStat).toHaveBeenNthCalledWith(3, '/tmp/repo/.git', { bigint: true })
    expect(mocks.fsStat).toHaveBeenNthCalledWith(4, '/tmp/repo/.git/objects', { bigint: true })
    expect(mocks.fetchAll).not.toHaveBeenCalled()
  })

  test('fast-fails when a remote repository is replaced at the same canonical path', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    mocks.resolveRemoteRepoExecutionIdentity
      .mockResolvedValueOnce({ commonDir: '/srv/repo/.git', generationKey: 'remote-generation-1' })
      .mockResolvedValueOnce({ commonDir: '/srv/repo/.git', generationKey: 'remote-generation-2' })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    await expect(fetchRepo(repoId, 'user')).resolves.toEqual({
      ok: false,
      message: 'error.repository-target-changed',
    })
    expect(mocks.fetchRemoteRepo).not.toHaveBeenCalled()
  })

  test('does not bind a local read to a locator when canonical resolution fails', async () => {
    mocks.resolveRepoCommonDir.mockRejectedValueOnce(new Error('git unavailable'))

    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')
    const { repoWriteOperationCoordinatorStatsForTests } =
      await import('#/server/modules/repo-write-operation-coordinator.ts')
    await expect(readRepoOperationsSnapshot(REPO_ID)).rejects.toThrow('error.repository-boundary-unavailable')
    expect(repoWriteOperationCoordinatorStatsForTests()).toMatchObject({
      boundaryRuntimes: 0,
      registeredBoundaries: 0,
    })
  })

  test('does not start captured worktree removal without a confirmed local boundary', async () => {
    mocks.resolveRepoCommonDir.mockRejectedValueOnce(new Error('git unavailable'))
    const beforeRemove = vi.fn(async () => ({ ok: true as const, message: '' }))
    const lifecycle = {
      beforeRemove,
      afterWorktreeRemoved: vi.fn(async () => ({ ok: true as const, message: '' })),
      afterRemoveFailed: vi.fn(async () => {}),
    }
    const [{ removeCapturedRepoWorktree }, { issuePhysicalWorktreeExecutionCapability }] = await Promise.all([
      import('#/server/modules/repo-write-paths.ts'),
      import('#/server/worktree-removal/physical-worktree-capability.ts'),
    ])
    const physicalWorktreeCapability = issuePhysicalWorktreeExecutionCapability(
      { kind: 'local', executionNamespaceId: 'local', endpoint: '/tmp/repo-worktree' },
      {
        userId: 'test-user',
        workspaceId: REPO_ID,
        workspaceRuntimeId: 'test-runtime',
        worktreePath: '/tmp/repo-worktree',
        execution: {
          kind: 'local',
          canonicalWorktreePath: '/tmp/repo-worktree',
          endpointMarker: { deviceId: 'test-device', inode: 'test-inode' },
        },
        runtimeSignal: new AbortController().signal,
        validateExecution: async () => undefined,
      },
    )

    await expect(
      removeCapturedRepoWorktree(
        REPO_ID,
        { branch: 'feature/a', worktreePath: '/tmp/repo-worktree', deleteBranch: true },
        lifecycle,
        physicalWorktreeCapability,
      ),
    ).rejects.toThrow('error.repository-boundary-unavailable')
    expect(beforeRemove).not.toHaveBeenCalled()
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
  })

  test('does not register a captured removal when locator and physical repository initially disagree', async () => {
    mocks.resolveRepoCommonDir.mockImplementation(async (cwd: string) =>
      cwd === '/tmp/repo' ? '/tmp/repo/.git' : '/tmp/other-repo/.git',
    )
    const beforeRemove = vi.fn(async () => ({ ok: true as const, message: '' }))
    const { repoWriteOperationCoordinatorStatsForTests } =
      await import('#/server/modules/repo-write-operation-coordinator.ts')

    await expect(
      removeLocalRepoWorktreeForTest(
        { deleteBranch: true },
        {
          beforeRemove,
          afterWorktreeRemoved: vi.fn(async () => ({ ok: true as const, message: '' })),
          afterRemoveFailed: vi.fn(async () => {}),
        },
      ),
    ).rejects.toThrow('error.repository-target-changed')
    expect(beforeRemove).not.toHaveBeenCalled()
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
    expect(repoWriteOperationCoordinatorStatsForTests()).toEqual({
      boundaryRuntimes: 0,
      registeredBoundaries: 0,
      registeredRepoIds: 0,
      queuedOperations: 0,
      runningOperations: 0,
    })
  })

  test('rejects real captured removal when its runtime closes during physical capture', async () => {
    const userId = 'test-user-runtime-capture'
    const clientId = 'test-client-runtime-capture'
    const captureStarted = deferred<void>()
    const releaseCapture = deferred<void>()
    let commonDirReads = 0
    mocks.resolveRepoCommonDir.mockImplementation(async () => {
      commonDirReads += 1
      if (commonDirReads === 2) {
        captureStarted.resolve()
        await releaseCapture.promise
      }
      return '/tmp/repo/.git'
    })
    const beforeRemove = vi.fn(async () => ({ ok: true as const, message: '' }))
    const [writePaths, capabilityModule, workspaceRuntimes, coordinator] = await Promise.all([
      import('#/server/modules/repo-write-paths.ts'),
      import('#/server/worktree-removal/physical-worktree-capability.ts'),
      import('#/server/modules/workspace-runtimes.ts'),
      import('#/server/modules/repo-write-operation-coordinator.ts'),
    ])
    workspaceRuntimes.clearWorkspaceRuntimesForUser(userId)
    const lease = workspaceRuntimes.acquireWorkspaceRuntimeLease(userId, REPO_ID, clientId)
    const physicalWorktreeCapability = capabilityModule.issuePhysicalWorktreeExecutionCapability(
      { kind: 'local', executionNamespaceId: 'local', endpoint: '/tmp/repo-worktree' },
      {
        userId,
        workspaceId: REPO_ID,
        workspaceRuntimeId: lease.workspaceRuntimeId,
        worktreePath: '/tmp/repo-worktree',
        execution: {
          kind: 'local',
          canonicalWorktreePath: '/tmp/repo-worktree',
          endpointMarker: { deviceId: '1', inode: '1' },
        },
        runtimeSignal: new AbortController().signal,
        validateExecution: async () => undefined,
      },
    )

    const removal = writePaths.removeCapturedRepoWorktree(
      REPO_ID,
      { branch: 'feature/a', worktreePath: '/tmp/repo-worktree', deleteBranch: true },
      {
        beforeRemove,
        afterWorktreeRemoved: vi.fn(async () => ({ ok: true as const, message: '' })),
        afterRemoveFailed: vi.fn(async () => {}),
      },
      physicalWorktreeCapability,
      undefined,
      { workspaceRuntimeId: lease.workspaceRuntimeId },
    )

    try {
      await captureStarted.promise
      expect(workspaceRuntimes.releaseWorkspaceRuntimeMembershipLease(userId, clientId, lease)).toEqual({
        released: true,
        runtimeClosed: true,
      })
      releaseCapture.resolve()

      await expect(removal).rejects.toThrow('error.workspace-runtime-stale')
      expect(mocks.getWorktrees).not.toHaveBeenCalled()
      expect(beforeRemove).not.toHaveBeenCalled()
      expect(mocks.removeWorktree).not.toHaveBeenCalled()
      expect(coordinator.repoWriteOperationCoordinatorStatsForTests()).toEqual({
        boundaryRuntimes: 0,
        registeredBoundaries: 0,
        registeredRepoIds: 0,
        queuedOperations: 0,
        runningOperations: 0,
      })
    } finally {
      releaseCapture.resolve()
      workspaceRuntimes.clearWorkspaceRuntimesForUser(userId)
    }
  })

  test('fast-fails captured worktree removal when its repository generation changes', async () => {
    mocks.fsStat
      .mockResolvedValueOnce({ isDirectory: () => true, dev: 1n, ino: 10n })
      .mockResolvedValueOnce({ isDirectory: () => true, dev: 1n, ino: 20n })
      .mockResolvedValueOnce({ isDirectory: () => true, dev: 1n, ino: 10n })
      .mockResolvedValueOnce({ isDirectory: () => true, dev: 1n, ino: 20n })
      .mockResolvedValueOnce({ isDirectory: () => true, dev: 1n, ino: 10n })
      .mockResolvedValueOnce({ isDirectory: () => true, dev: 1n, ino: 21n })
      .mockResolvedValueOnce({ isDirectory: () => true, dev: 1n, ino: 10n })
      .mockResolvedValueOnce({ isDirectory: () => true, dev: 1n, ino: 21n })
    const beforeRemove = vi.fn(async () => ({ ok: true as const, message: '' }))
    const lifecycle = {
      beforeRemove,
      afterWorktreeRemoved: vi.fn(async () => ({ ok: true as const, message: '' })),
      afterRemoveFailed: vi.fn(async () => {}),
    }
    const [{ removeCapturedRepoWorktree }, { issuePhysicalWorktreeExecutionCapability }] = await Promise.all([
      import('#/server/modules/repo-write-paths.ts'),
      import('#/server/worktree-removal/physical-worktree-capability.ts'),
    ])
    const physicalWorktreeCapability = issuePhysicalWorktreeExecutionCapability(
      { kind: 'local', executionNamespaceId: 'local', endpoint: '/tmp/repo-worktree' },
      {
        userId: 'test-user',
        workspaceId: REPO_ID,
        workspaceRuntimeId: 'test-runtime',
        worktreePath: '/tmp/repo-worktree',
        execution: {
          kind: 'local',
          canonicalWorktreePath: '/tmp/repo-worktree',
          endpointMarker: { deviceId: 'test-device', inode: 'test-inode' },
        },
        runtimeSignal: new AbortController().signal,
        validateExecution: async () => undefined,
      },
    )

    await expect(
      removeCapturedRepoWorktree(
        REPO_ID,
        { branch: 'feature/a', worktreePath: '/tmp/repo-worktree', deleteBranch: true },
        lifecycle,
        physicalWorktreeCapability,
      ),
    ).resolves.toEqual({ ok: false, message: 'error.repository-target-changed' })
    expect(beforeRemove).not.toHaveBeenCalled()
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
  })

  test('fast-fails captured worktree removal when its workspace locator moves to another repository', async () => {
    let repoLocatorReads = 0
    mocks.fsRealpath.mockImplementation(async (cwd: string) => {
      if (cwd !== '/tmp/repo') return cwd
      repoLocatorReads += 1
      return repoLocatorReads === 1 ? '/tmp/repo' : '/tmp/replacement-repo'
    })
    const beforeRemove = vi.fn(async () => ({ ok: true as const, message: '' }))

    await expect(
      removeLocalRepoWorktreeForTest(
        { deleteBranch: true },
        {
          beforeRemove,
          afterWorktreeRemoved: vi.fn(async () => ({ ok: true as const, message: '' })),
          afterRemoveFailed: vi.fn(async () => {}),
        },
      ),
    ).resolves.toEqual({ ok: false, message: 'error.repository-target-changed' })
    expect(beforeRemove).not.toHaveBeenCalled()
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
  })

  test('fast-fails captured worktree removal when its SSH locator moves to another repository', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const targetA: RemoteWorkspaceTarget = {
      id: repoId,
      alias: 'prod',
      host: 'repo-a.example.test',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
      sshConnection: {
        destination: 'prod',
        options: ['hostname=repo-a.example.test', 'user=deploy', 'port=22'],
      },
    }
    const targetB: RemoteWorkspaceTarget = {
      ...targetA,
      host: 'repo-b.example.test',
      remotePath: '/srv/replacement-repo',
      sshConnection: {
        destination: 'prod',
        options: ['hostname=repo-b.example.test', 'user=deploy', 'port=22'],
      },
    }
    mocks.resolveRemoteTarget
      .mockResolvedValueOnce({ target: targetA, configFingerprint: 'config-a' })
      .mockResolvedValueOnce({ target: targetB, configFingerprint: 'config-b' })
    const beforeRemove = vi.fn(async () => ({ ok: true as const, message: '' }))
    const [{ removeCapturedRepoWorktree }, { issuePhysicalWorktreeExecutionCapability }] = await Promise.all([
      import('#/server/modules/repo-write-paths.ts'),
      import('#/server/worktree-removal/physical-worktree-capability.ts'),
    ])
    const physicalWorktreeCapability = issuePhysicalWorktreeExecutionCapability(
      { kind: 'remote', executionNamespaceId: 'prod', endpoint: '/srv/repo-worktree' },
      {
        userId: 'test-user',
        workspaceId: repoId,
        workspaceRuntimeId: 'test-runtime',
        worktreePath: '/srv/repo-worktree',
        execution: {
          kind: 'remote',
          canonicalWorktreePath: '/srv/repo-worktree',
          target: targetA,
          configFingerprint: 'config-a',
          endpointMarker: { deviceId: '1', inode: '1' },
        },
        runtimeSignal: new AbortController().signal,
        validateExecution: async () => undefined,
      },
    )

    await expect(
      removeCapturedRepoWorktree(
        repoId,
        { branch: 'feature/a', worktreePath: '/srv/repo-worktree', deleteBranch: true },
        {
          beforeRemove,
          afterWorktreeRemoved: vi.fn(async () => ({ ok: true as const, message: '' })),
          afterRemoveFailed: vi.fn(async () => {}),
        },
        physicalWorktreeCapability,
      ),
    ).resolves.toEqual({ ok: false, message: 'error.repository-target-changed' })
    expect(beforeRemove).not.toHaveBeenCalled()
    expect(mocks.removeRemoteWorktree).not.toHaveBeenCalled()
  })

  test('preserves cancellation while resolving a local canonical boundary', async () => {
    const caller = new AbortController()
    mocks.resolveRepoCommonDir.mockImplementationOnce(
      async (_cwd: string, options?: { signal?: AbortSignal }) =>
        await new Promise<string>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
        }),
    )

    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')
    const read = readRepoOperationsSnapshot(REPO_ID, { signal: caller.signal })
    caller.abort(new Error('client disconnected'))

    await expect(read).rejects.toThrow('client disconnected')
  })
})
