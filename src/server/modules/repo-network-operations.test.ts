import { describe, expect, test, vi } from 'vitest'
import { normalizeRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import { REPO_ID, expectNoRepoSnapshotInvalidations, mocks } from '#/server/test-utils/repo-module.ts'

describe('fetchRepo coordination', () => {
  test('serializes different SSH aliases for the same resolved repository', async () => {
    const firstRepoId = normalizeRemoteWorkspaceId({ alias: 'prod-a', remotePath: '/srv/repo' })
    const secondRepoId = normalizeRemoteWorkspaceId({ alias: 'prod-b', remotePath: '/srv/repo' })
    mocks.resolveRemoteTarget.mockImplementation(async (ref: { alias: string; remotePath: string }) => ({
      target: {
        id: normalizeRemoteWorkspaceId(ref),
        alias: ref.alias,
        host: 'shared.example',
        user: 'deploy',
        port: 22,
        remotePath: ref.remotePath,
        displayName: `${ref.alias}:repo`,
        sshConnection: {
          destination: ref.alias,
          options: ['hostname=shared.example', 'user=deploy', 'port=22'],
        },
      },
    }))
    const firstFetch = Promise.withResolvers<{ ok: true; message: string }>()
    mocks.fetchRemoteRepo.mockImplementationOnce(async () => await firstFetch.promise)
    mocks.fetchRemoteRepo.mockResolvedValueOnce({ ok: true, message: 'fetched second alias' })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const first = fetchRepo(firstRepoId, 'background')
    await vi.waitFor(() => expect(mocks.fetchRemoteRepo).toHaveBeenCalledTimes(1))
    const second = fetchRepo(secondRepoId, 'user')
    await Promise.resolve()
    expect(mocks.fetchRemoteRepo).toHaveBeenCalledTimes(1)

    firstFetch.resolve({ ok: true, message: 'fetched first alias' })
    await expect(first).resolves.toEqual({ ok: true, message: 'fetched first alias' })
    await expect(second).resolves.toEqual({ ok: true, message: 'fetched second alias' })
    expect(mocks.fetchRemoteRepo).toHaveBeenCalledTimes(2)
  })

  test('keeps aliases with OpenSSH percent-n semantics on distinct boundaries', async () => {
    const firstRepoId = normalizeRemoteWorkspaceId({ alias: 'proxy-a', remotePath: '/srv/repo' })
    const secondRepoId = normalizeRemoteWorkspaceId({ alias: 'proxy-b', remotePath: '/srv/repo' })
    mocks.resolveRemoteTarget.mockImplementation(async (ref: { alias: string; remotePath: string }) => ({
      target: {
        id: normalizeRemoteWorkspaceId(ref),
        alias: ref.alias,
        host: 'shared.example',
        user: 'deploy',
        port: 22,
        remotePath: ref.remotePath,
        displayName: `${ref.alias}:repo`,
        sshConnection: {
          destination: ref.alias,
          options: ['hostname=shared.example', 'proxycommand=connect-via %n'],
        },
      },
    }))
    const firstFetch = Promise.withResolvers<{ ok: true; message: string }>()
    const secondFetch = Promise.withResolvers<{ ok: true; message: string }>()
    mocks.fetchRemoteRepo.mockImplementation(async (target: { alias: string }) =>
      target.alias === 'proxy-a' ? await firstFetch.promise : await secondFetch.promise,
    )

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const first = fetchRepo(firstRepoId, 'background')
    const second = fetchRepo(secondRepoId, 'background')
    await vi.waitFor(() => expect(mocks.fetchRemoteRepo).toHaveBeenCalledTimes(2))

    firstFetch.resolve({ ok: true, message: 'fetched proxy a' })
    secondFetch.resolve({ ok: true, message: 'fetched proxy b' })
    await expect(first).resolves.toEqual({ ok: true, message: 'fetched proxy a' })
    await expect(second).resolves.toEqual({ ok: true, message: 'fetched proxy b' })
  })

  test('remote syncs for different repos under the same alias use distinct write boundaries', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo-a' })
    const otherRepoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo-b' })
    mocks.resolveRemoteTarget.mockImplementation(async (ref: { alias: string; remotePath: string }) => ({
      target: {
        id: normalizeRemoteWorkspaceId(ref),
        alias: ref.alias,
        host: 'example.test',
        user: 'deploy',
        port: 22,
        remotePath: ref.remotePath,
        displayName: `${ref.alias}:${ref.remotePath}`,
      },
    }))
    mocks.resolveRemoteRepoCommonDir.mockImplementation(async (target: { remotePath: string }) => target.remotePath)
    const first = Promise.withResolvers<{ ok: true; message: string }>()
    const second = Promise.withResolvers<{ ok: true; message: string }>()
    const fetchPaths: string[] = []
    mocks.fetchRemoteRepo.mockImplementation(async (target: { remotePath: string }) => {
      fetchPaths.push(target.remotePath)
      if (target.remotePath === '/srv/repo-a') return await first.promise
      if (target.remotePath === '/srv/repo-b') return await second.promise
      return { ok: true, message: 'fetched' }
    })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const active = fetchRepo(repoId, 'background')
    await vi.waitFor(() => {
      expect(fetchPaths).toEqual(['/srv/repo-a'])
    })

    const other = fetchRepo(otherRepoId, 'background')
    await vi.waitFor(() => {
      expect(fetchPaths).toEqual(['/srv/repo-a', '/srv/repo-b'])
    })

    first.resolve({ ok: true, message: 'fetched first' })
    second.resolve({ ok: true, message: 'fetched second' })

    await expect(active).resolves.toEqual({ ok: true, message: 'fetched first' })
    await expect(other).resolves.toEqual({ ok: true, message: 'fetched second' })
  })

  test('caller abort records wait cancellation for a queued user sync', async () => {
    const deleteBranch = Promise.withResolvers<{ ok: true; message: string }>()
    mocks.deleteBranch.mockImplementationOnce(async () => await deleteBranch.promise)
    mocks.fetchAll.mockResolvedValueOnce({ ok: true, message: 'fetched' })

    const { deleteRepoBranch, fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')

    const write = deleteRepoBranch(REPO_ID, 'feature/a')
    await vi.waitFor(() => {
      expect(mocks.deleteBranch).toHaveBeenCalledTimes(1)
    })

    const background = fetchRepo(REPO_ID, 'background')
    await vi.waitFor(async () => {
      expect((await readRepoOperationsSnapshot(REPO_ID)).operations).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'fetch', phase: 'queued' })]),
      )
    })

    const caller = new AbortController()
    const user = fetchRepo(REPO_ID, 'user', caller.signal)
    await vi.waitFor(async () => {
      expect((await readRepoOperationsSnapshot(REPO_ID)).operations).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'fetch', phase: 'queued', source: 'user' })]),
      )
    })
    caller.abort('client disconnected')

    await expect(user).resolves.toEqual({ ok: false, message: 'cancelled' })
    expect(mocks.fetchAll).not.toHaveBeenCalled()
    expectNoRepoSnapshotInvalidations()
    await expect(readRepoOperationsSnapshot(REPO_ID, { includeSettled: true })).resolves.toMatchObject({
      operations: expect.arrayContaining([
        expect.objectContaining({
          kind: 'fetch',
          source: 'user',
          phase: 'failed',
          cancellation: expect.objectContaining({
            waitCancelledCount: 1,
            lastWaitCancellationReason: 'caller-abort',
          }),
          error: expect.objectContaining({
            message: 'cancelled',
            reason: 'caller-abort',
          }),
        }),
      ]),
    })

    deleteBranch.resolve({ ok: true, message: 'deleted' })
    await expect(write).resolves.toEqual({ ok: true, message: 'deleted' })
    await expect(background).resolves.toEqual({ ok: true, message: 'fetched' })
  })

  test('does not publish invalidations after a failed sync', async () => {
    mocks.fetchAll.mockResolvedValueOnce({ ok: false, message: 'fatal: offline' })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepo(REPO_ID, 'background')

    expect(result).toEqual({ ok: false, message: 'fatal: offline' })
    expectNoRepoSnapshotInvalidations()
  })
})

describe('cloneRepo cancellation', () => {
  test('returns cancelled before clone preflight side effects when caller is already aborted', async () => {
    const caller = new AbortController()
    caller.abort('client disconnected')

    const { cloneRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await cloneRepo('https://example.com/repo.git', '/tmp', 'repo', caller.signal)

    expect(result).toEqual({ ok: false, message: 'cancelled' })
    expect(mocks.checkGitAvailable).not.toHaveBeenCalled()
    expect(mocks.fsMkdir).not.toHaveBeenCalled()
    expect(mocks.cloneGitRepo).not.toHaveBeenCalled()
  })

  test('merges caller abort signal into clone operations', async () => {
    const caller = new AbortController()
    mocks.cloneGitRepo.mockImplementationOnce(
      async (_parentPath: string, _directoryName: string, _url: string, signal) => {
        expect(signal?.aborted).toBe(false)
        caller.abort('stopped')
        expect(signal?.aborted).toBe(true)
        return { ok: false, message: 'cancelled' }
      },
    )

    const { cloneRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await cloneRepo('https://example.com/repo.git', '/tmp', 'repo', caller.signal)

    expect(result).toEqual({ ok: false, message: 'cancelled' })
  })

  test('records clone operation state and structured caller cancellation', async () => {
    mocks.cloneGitRepo.mockImplementationOnce(
      (_parentPath: string, _directoryName: string, _url: string, signal?: AbortSignal) =>
        new Promise((resolve) => {
          signal?.addEventListener('abort', () => resolve({ ok: false, message: 'cancelled' }))
        }),
    )
    const { cloneRepo } = await import('#/server/modules/repo-write-paths.ts')
    const { listRepoServerOperations } = await import('#/server/modules/repo-operation-registry.ts')
    const caller = new AbortController()

    const work = cloneRepo('https://example.com/repo.git', '/tmp', 'repo', caller.signal)
    let operationId = ''
    await vi.waitFor(() => {
      const operation = listRepoServerOperations({ includeSettled: true }).find(
        (operation) => operation.kind === 'clone',
      )
      expect(operation).toMatchObject({
        kind: 'clone',
        phase: 'running',
        target: { parentPath: '/tmp', directoryName: 'repo' },
      })
      operationId = operation!.id
    })

    caller.abort('stopped')
    await expect(work).resolves.toEqual({ ok: false, message: 'cancelled' })
    expect(
      listRepoServerOperations({ includeSettled: true }).find((operation) => operation.id === operationId),
    ).toMatchObject({
      kind: 'clone',
      phase: 'failed',
      cancellation: {
        underlyingRequested: true,
        reason: 'caller-abort',
      },
      error: {
        message: 'cancelled',
        reason: 'caller-abort',
      },
    })
  })
})
