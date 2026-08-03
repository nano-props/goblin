import { describe, expect, test, vi } from 'vitest'
import { normalizeRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import type { CommandOutcome } from '#/system/command-execution.ts'
import { commandOutcomeForTest } from '#/test-utils/command-outcome.ts'
import {
  LINKED_REPO_ID,
  REPO_ID,
  expectNoRepoMetadataInvalidations,
  mocks,
  removeLocalRepoWorktreeForTest,
} from '#/server/test-utils/repo-module.ts'

describe('fetchRepo canonical boundaries', () => {
  test('does not execute fetch when affected-worktree discovery fails', async () => {
    mocks.readWorktreeMembership.mockRejectedValueOnce(new Error('worktree discovery failed'))

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')

    await expect(fetchRepo(REPO_ID, 'user')).rejects.toThrow('worktree discovery failed')
    expect(mocks.fetchAll).not.toHaveBeenCalled()
    expectNoRepoMetadataInvalidations()
  })

  test('does not execute remote fetch when affected-worktree discovery fails', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    mocks.getRemoteRepoWorktreePaths.mockRejectedValueOnce(new Error('remote worktree discovery failed'))

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')

    await expect(fetchRepo(repoId, 'user')).rejects.toThrow('remote worktree discovery failed')
    expect(mocks.fetchRemoteRepo).not.toHaveBeenCalled()
    expectNoRepoMetadataInvalidations()
  })

  test.each([
    ['user', 'user'],
    ['background', 'background'],
  ])('%s sync publishes snapshot invalidation after fetching with prune', async (_name, kind) => {
    mocks.fetchAll.mockResolvedValueOnce(commandOutcomeForTest({ ok: true, message: 'fetched' }))

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepo(REPO_ID, kind as 'user' | 'background')

    expect(result).toEqual({ ok: true, message: 'fetched', repoIdsToInvalidate: [REPO_ID] })
    expect(mocks.fetchAll).toHaveBeenCalledWith('/tmp/repo', expect.any(AbortSignal))
    expectNoRepoMetadataInvalidations()
  })

  test('merges caller abort signal into fetch operations', async () => {
    const caller = new AbortController()
    mocks.fetchAll.mockImplementationOnce(async (_cwd: string, signal?: AbortSignal) => {
      expect(signal?.aborted).toBe(false)
      caller.abort('stopped')
      expect(signal?.aborted).toBe(true)
      return { result: { ok: false, message: 'cancelled' }, execution: { status: 'cancelled' } }
    })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepo(REPO_ID, 'user', caller.signal)

    expect(result).toEqual({
      ok: false,
      message: 'error.git-command-cancelled-check-state',
      repoIdsToInvalidate: [REPO_ID],
    })
    expectNoRepoMetadataInvalidations()
  })

  test('reports an uncertain result when fetch times out after starting', async () => {
    mocks.fetchAll.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'git timed out after 90s' }, 'timed-out'),
    )

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepo(REPO_ID, 'user')

    expect(result).toEqual({
      ok: false,
      message: 'error.git-command-timeout-check-state',
      repoIdsToInvalidate: [REPO_ID],
    })
    expectNoRepoMetadataInvalidations()
  })

  test('selects recovery guidance when a remote fetch outcome cannot be confirmed', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    mocks.getRemoteRepoWorktreePaths.mockResolvedValueOnce(['/srv/repo'])
    mocks.fetchRemoteRepo.mockResolvedValueOnce(
      commandOutcomeForTest(
        { ok: false, message: 'remote command execution could not be confirmed' },
        'remote-start-unconfirmed',
      ),
    )

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepo(repoId, 'user')

    expect(result).toEqual({
      ok: false,
      message: 'error.ssh-remote-command-start-unconfirmed',
      repoIdsToInvalidate: [repoId],
    })
    expectNoRepoMetadataInvalidations()
  })

  test('publishes snapshot invalidation after a successful sync', async () => {
    mocks.fetchAll.mockResolvedValueOnce(commandOutcomeForTest({ ok: true, message: 'fetched' }))

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepo(REPO_ID, 'user')

    expect(result).toEqual({ ok: true, message: 'fetched', repoIdsToInvalidate: [REPO_ID] })
    expectNoRepoMetadataInvalidations()
  })

  test('shares successful fetch time across worktrees with one write boundary', async () => {
    mocks.resolveRepoCommonDir.mockResolvedValue('/tmp/repo/.git')
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      { path: '/tmp/repo-linked', branch: 'feature/a', isBare: false, isPrimary: false },
    ])
    mocks.fetchAll.mockResolvedValueOnce(commandOutcomeForTest({ ok: true, message: 'fetched' }))
    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')
    const { resolveRepoWriteBoundaryForRead } = await import('#/server/modules/repo-write-operation-coordinator.ts')

    await resolveRepoWriteBoundaryForRead(LINKED_REPO_ID, { workspaceRuntimeId: 'workspace-runtime-b' })
    await fetchRepo(REPO_ID, 'user', undefined, 'workspace-runtime-a')

    const primary = await readRepoOperationsSnapshot(REPO_ID, { workspaceRuntimeId: 'workspace-runtime-a' })
    const linked = await readRepoOperationsSnapshot(LINKED_REPO_ID, { workspaceRuntimeId: 'workspace-runtime-b' })
    expect(primary.lastFetchAt).toEqual(expect.any(Number))
    expect(linked.lastFetchAt).toBe(primary.lastFetchAt)
  })

  test('publishes sibling worktree snapshot invalidations after a successful sync', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      { path: '/tmp/repo-linked', branch: 'feature/a', isBare: false, isPrimary: false },
    ])
    mocks.fetchAll.mockResolvedValueOnce(commandOutcomeForTest({ ok: true, message: 'fetched' }))

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepo(REPO_ID, 'user')

    expect(result).toEqual({
      ok: true,
      message: 'fetched',
      repoIdsToInvalidate: [REPO_ID, LINKED_REPO_ID],
    })
    expectNoRepoMetadataInvalidations()
  })

  test('user sync waits for an active sibling worktree background sync before fetching', async () => {
    mocks.resolveRepoCommonDir.mockImplementation(async (cwd: string) =>
      cwd === '/tmp/repo' || cwd === '/tmp/repo-linked' ? '/tmp/repo/.git' : `${cwd}/.git`,
    )
    mocks.readWorktreeMembership.mockResolvedValue([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      { path: '/tmp/repo-linked', branch: 'feature/a', isBare: false, isPrimary: false },
    ])
    const fetch = Promise.withResolvers<CommandOutcome>()
    mocks.fetchAll.mockImplementationOnce(() => fetch.promise)
    mocks.fetchAll.mockResolvedValueOnce(commandOutcomeForTest({ ok: true, message: 'fetched by user' }))

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const background = fetchRepo(REPO_ID, 'background')
    await vi.waitFor(() => {
      expect(mocks.fetchAll).toHaveBeenCalledTimes(1)
    })
    const user = fetchRepo(LINKED_REPO_ID, 'user')

    fetch.resolve(commandOutcomeForTest({ ok: true, message: 'fetched in background' }))
    const [backgroundResult, userResult] = await Promise.all([background, user])

    expect(backgroundResult).toEqual({
      ok: true,
      message: 'fetched in background',
      repoIdsToInvalidate: [REPO_ID, LINKED_REPO_ID],
    })
    expect(userResult).toEqual({
      ok: true,
      message: 'fetched by user',
      repoIdsToInvalidate: [LINKED_REPO_ID, REPO_ID],
    })
    expect(mocks.fetchAll).toHaveBeenCalledTimes(2)
    expectNoRepoMetadataInvalidations()
  })

  test('user sync waits for an active remote background sync with the same alias', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const linkedRepoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo-linked' })
    mocks.getRemoteRepoWorktreePaths.mockResolvedValue(['/srv/repo', '/srv/repo-linked'])
    const fetch = Promise.withResolvers<CommandOutcome>()
    mocks.fetchRemoteRepo.mockImplementationOnce(async () => await fetch.promise)
    mocks.fetchRemoteRepo.mockResolvedValueOnce(commandOutcomeForTest({ ok: true, message: 'fetched by user' }))

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const background = fetchRepo(repoId, 'background')
    await vi.waitFor(() => {
      expect(mocks.fetchRemoteRepo).toHaveBeenCalledTimes(1)
    })
    const user = fetchRepo(linkedRepoId, 'user')

    fetch.resolve(commandOutcomeForTest({ ok: true, message: 'fetched in background' }))
    const [backgroundResult, userResult] = await Promise.all([background, user])

    expect(backgroundResult).toEqual({
      ok: true,
      message: 'fetched in background',
      repoIdsToInvalidate: [repoId, linkedRepoId],
    })
    expect(userResult).toEqual({
      ok: true,
      message: 'fetched by user',
      repoIdsToInvalidate: [repoId, linkedRepoId],
    })
    expect(mocks.fetchRemoteRepo).toHaveBeenCalledTimes(2)
    expectNoRepoMetadataInvalidations()
  })

  test('does not admit a remote write without a confirmed canonical boundary', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    mocks.resolveRemoteRepoCommonDir.mockResolvedValue(null)

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

  test('reads operation state from memory without canonical boundary resolution', async () => {
    mocks.resolveRepoCommonDir.mockRejectedValueOnce(new Error('git unavailable'))

    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')
    const { repoWriteOperationCoordinatorStatsForTests } =
      await import('#/server/modules/repo-write-operation-coordinator.ts')
    await expect(readRepoOperationsSnapshot(REPO_ID)).resolves.toMatchObject({ operations: [], lastFetchAt: null })
    expect(mocks.resolveRepoCommonDir).not.toHaveBeenCalled()
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
        },
        runtimeSignal: new AbortController().signal,
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
        },
      ),
    ).rejects.toThrow('error.repository-boundary-unavailable')
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
    const captureStarted = Promise.withResolvers<void>()
    const releaseCapture = Promise.withResolvers<void>()
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
        },
        runtimeSignal: new AbortController().signal,
      },
    )

    const removal = writePaths.removeCapturedRepoWorktree(
      REPO_ID,
      { branch: 'feature/a', worktreePath: '/tmp/repo-worktree', deleteBranch: true },
      {
        beforeRemove,
        afterWorktreeRemoved: vi.fn(async () => ({ ok: true as const, message: '' })),
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
      expect(mocks.readWorktreeMembership).not.toHaveBeenCalled()
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

  test('rejects an already-cancelled in-memory operations read', async () => {
    const caller = new AbortController()
    caller.abort(new Error('client disconnected'))

    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')
    const read = readRepoOperationsSnapshot(REPO_ID, { signal: caller.signal })

    await expect(read).rejects.toThrow('client disconnected')
    expect(mocks.resolveRepoCommonDir).not.toHaveBeenCalled()
  })
})
