import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  abortRepoWriteNetworkOperation,
  enqueueRepoWriteOperation,
  listRepoWriteOperationsForRepo,
  repoWriteOperationCoordinatorStatsForTests,
  resetRepoWriteOperationCoordinatorForTests,
} from '#/server/modules/repo-write-operation-coordinator.ts'

const mocks = vi.hoisted(() => ({
  resolveRepoWriteBoundaryKey: vi.fn(async (repoId: string) => repoId),
  publishRepoQueryInvalidation: vi.fn(),
}))

vi.mock('#/server/modules/repo-source.ts', () => ({
  resolveRepoWriteBoundaryKey: mocks.resolveRepoWriteBoundaryKey,
}))

vi.mock('#/server/modules/invalidation-broker.ts', () => ({
  publishRepoQueryInvalidation: mocks.publishRepoQueryInvalidation,
}))

beforeEach(() => {
  resetRepoWriteOperationCoordinatorForTests()
  mocks.resolveRepoWriteBoundaryKey.mockReset()
  mocks.resolveRepoWriteBoundaryKey.mockImplementation(async (repoId: string) => repoId)
  mocks.publishRepoQueryInvalidation.mockReset()
  vi.useFakeTimers()
  vi.setSystemTime(0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('repo write operation coordinator', () => {
  test('does not block an unrelated repo behind slow boundary resolution', async () => {
    const slowBoundary = Promise.withResolvers<string>()
    mocks.resolveRepoWriteBoundaryKey.mockImplementation(async (repoId: string) => {
      if (repoId === '/tmp/repo-slow') return await slowBoundary.promise
      return repoId
    })
    const slowWork = enqueueRepoWriteOperation(
      '/tmp/repo-slow',
      undefined,
      { repoId: '/tmp/repo-slow', kind: 'fetch', source: 'background' },
      (operation) => async () => {
        operation.start()
        operation.settle({ ok: true })
        return { ok: true, message: 'slow' }
      },
    )

    await expect(
      enqueueRepoWriteOperation(
        '/tmp/repo-fast',
        undefined,
        { repoId: '/tmp/repo-fast', kind: 'fetch', source: 'background' },
        (operation) => async () => {
          operation.start()
          operation.settle({ ok: true })
          return { ok: true, message: 'fast' }
        },
      ),
    ).resolves.toEqual({ ok: true, message: 'fast' })

    slowBoundary.resolve('/tmp/repo-slow')
    await expect(slowWork).resolves.toEqual({ ok: true, message: 'slow' })
  })

  test('does not register an operation when boundary resolution is aborted', async () => {
    const caller = new AbortController()
    mocks.resolveRepoWriteBoundaryKey.mockImplementation(
      async (_repoId: string, signal?: AbortSignal) =>
        await new Promise<string>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        }),
    )

    const work = enqueueRepoWriteOperation(
      '/tmp/repo',
      caller.signal,
      { repoId: '/tmp/repo', kind: 'fetch', source: 'background' },
      () => async () => ({ ok: true, message: 'unexpected' }),
    )
    caller.abort()

    await expect(work).resolves.toEqual({ ok: false, message: 'cancelled' })
    expect(repoWriteOperationCoordinatorStatsForTests()).toEqual({
      boundaryRuntimes: 0,
      registeredBoundaries: 0,
      registeredRepoIds: 0,
      queuedOperations: 0,
      runningOperations: 0,
    })
  })

  test('serializes aliases that concurrently resolve to one physical boundary', async () => {
    mocks.resolveRepoWriteBoundaryKey.mockResolvedValue('/tmp/repo/.git')
    const releaseFirst = Promise.withResolvers<void>()
    const order: string[] = []
    const first = enqueueRepoWriteOperation(
      '/tmp/repo',
      undefined,
      { repoId: '/tmp/repo', kind: 'fetch', source: 'background' },
      (operation) => async () => {
        operation.start()
        order.push('first-start')
        await releaseFirst.promise
        order.push('first-end')
        operation.settle({ ok: true })
        return { ok: true, message: 'first' }
      },
    )
    const second = enqueueRepoWriteOperation(
      '/tmp/repo-linked',
      undefined,
      { repoId: '/tmp/repo-linked', kind: 'fetch', source: 'background' },
      (operation) => async () => {
        operation.start()
        order.push('second')
        operation.settle({ ok: true })
        return { ok: true, message: 'second' }
      },
    )

    await vi.waitFor(() => expect(order).toEqual(['first-start']))
    releaseFirst.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second'])
  })

  test('settles operations when the queued task throws', async () => {
    await expect(
      enqueueRepoWriteOperation(
        '/tmp/repo',
        undefined,
        { repoId: '/tmp/repo', kind: 'delete-branch', source: 'user' },
        (operation) => async () => {
          operation.start()
          throw new Error('boom')
        },
      ),
    ).rejects.toThrow('boom')

    await expect(listRepoWriteOperationsForRepo('/tmp/repo', { includeSettled: true })).resolves.toMatchObject([
      {
        repoId: '/tmp/repo',
        kind: 'delete-branch',
        phase: 'failed',
        error: { message: 'boom' },
      },
    ])
    expect(repoWriteOperationCoordinatorStatsForTests()).toMatchObject({
      queuedOperations: 0,
      runningOperations: 0,
    })
  })

  test('filters write operations by runtime while retaining repo-scoped operations', async () => {
    await enqueueRepoWriteOperation(
      '/tmp/repo',
      undefined,
      { repoId: '/tmp/repo', kind: 'fetch', source: 'background' },
      (operation) => async () => {
        operation.start()
        operation.settle({ ok: true, message: 'repo-scoped' })
        return { ok: true, message: 'repo-scoped' }
      },
    )
    await enqueueRepoWriteOperation(
      '/tmp/repo',
      undefined,
      { repoId: '/tmp/repo', workspaceRuntimeId: 'repo-runtime-current', kind: 'delete-branch', source: 'user' },
      (operation) => async () => {
        operation.start()
        operation.settle({ ok: true, message: 'current' })
        return { ok: true, message: 'current' }
      },
    )
    await enqueueRepoWriteOperation(
      '/tmp/repo',
      undefined,
      { repoId: '/tmp/repo', workspaceRuntimeId: 'repo-runtime-stale', kind: 'remove-worktree', source: 'user' },
      (operation) => async () => {
        operation.start()
        operation.settle({ ok: true, message: 'stale' })
        return { ok: true, message: 'stale' }
      },
    )

    await expect(
      listRepoWriteOperationsForRepo('/tmp/repo', { workspaceRuntimeId: 'repo-runtime-current', includeSettled: true }),
    ).resolves.toMatchObject([
      { kind: 'fetch', workspaceRuntimeId: null },
      { kind: 'delete-branch', workspaceRuntimeId: 'repo-runtime-current' },
    ])
  })

  test('keeps settled write operations globally bounded', async () => {
    for (let index = 0; index < 105; index += 1) {
      const repoId = `/tmp/repo-${index}`
      vi.setSystemTime(1_000 + index)
      await enqueueRepoWriteOperation(
        repoId,
        undefined,
        { repoId, kind: 'fetch', source: 'background' },
        (operation) => async () => {
          operation.start()
          operation.settle({ ok: true, message: 'ok' })
          return { ok: true, message: 'ok' }
        },
      )
    }

    await expect(listRepoWriteOperationsForRepo(undefined, { includeSettled: true })).resolves.toHaveLength(100)
    await expect(listRepoWriteOperationsForRepo('/tmp/repo-0', { includeSettled: true })).resolves.toEqual([])
    await expect(listRepoWriteOperationsForRepo('/tmp/repo-104', { includeSettled: true })).resolves.toMatchObject([
      { repoId: '/tmp/repo-104', kind: 'fetch', phase: 'done' },
    ])
  })

  test('runs cancellable network operations inside the repo write runtime', async () => {
    let resolveFetch!: (value: { ok: true; message: string }) => void
    const work = enqueueRepoWriteOperation(
      '/tmp/repo',
      undefined,
      { repoId: '/tmp/repo', kind: 'fetch', source: 'background' },
      (_operation, context) => async () =>
        await context.runNetworkOperation(
          () =>
            new Promise<{ ok: true; message: string }>((resolve) => {
              resolveFetch = resolve
            }),
        ),
    )

    await vi.waitFor(async () => {
      await expect(listRepoWriteOperationsForRepo('/tmp/repo')).resolves.toMatchObject([
        {
          repoId: '/tmp/repo',
          kind: 'fetch',
          phase: 'running',
          source: 'background',
        },
      ])
    })

    resolveFetch({ ok: true, message: 'ok' })
    await expect(work).resolves.toEqual({ ok: true, message: 'ok' })
    await expect(listRepoWriteOperationsForRepo('/tmp/repo')).resolves.toEqual([])
    await expect(listRepoWriteOperationsForRepo('/tmp/repo', { includeSettled: true })).resolves.toMatchObject([
      {
        kind: 'fetch',
        phase: 'done',
        error: null,
      },
    ])
  })

  test('cancels the active network operation for the resolved write boundary', async () => {
    mocks.resolveRepoWriteBoundaryKey.mockImplementation(async (repoId: string) =>
      repoId === '/tmp/repo' || repoId === '/tmp/repo-linked' ? '/tmp/repo/.git' : repoId,
    )
    const work = enqueueRepoWriteOperation(
      '/tmp/repo',
      undefined,
      { repoId: '/tmp/repo', kind: 'pull', source: 'user' },
      (_operation, context) => async () =>
        await context.runNetworkOperation(
          (signal) =>
            new Promise<{ ok: false; message: string }>((resolve) => {
              signal.addEventListener('abort', () => resolve({ ok: false, message: 'cancelled' }))
            }),
        ),
    )

    await vi.waitFor(async () => {
      await expect(listRepoWriteOperationsForRepo('/tmp/repo')).resolves.toMatchObject([
        {
          kind: 'pull',
          phase: 'running',
        },
      ])
    })
    await expect(abortRepoWriteNetworkOperation('/tmp/repo-linked')).resolves.toBe(true)

    await expect(work).resolves.toEqual({ ok: false, message: 'cancelled' })
    await expect(listRepoWriteOperationsForRepo('/tmp/repo', { includeSettled: true })).resolves.toMatchObject([
      {
        kind: 'pull',
        phase: 'failed',
        cancellation: {
          underlyingRequested: true,
          reason: 'user-cancel',
        },
        error: {
          message: 'cancelled',
          reason: 'user-cancel',
        },
      },
    ])
  })

  test('publishes repo-runtime invalidations to known sibling repos sharing a write boundary', async () => {
    mocks.resolveRepoWriteBoundaryKey.mockImplementation(async (repoId: string) =>
      repoId === '/tmp/repo' || repoId === '/tmp/repo-linked' ? '/tmp/repo/.git' : repoId,
    )
    await expect(listRepoWriteOperationsForRepo('/tmp/repo-linked')).resolves.toEqual([])
    mocks.publishRepoQueryInvalidation.mockClear()

    await enqueueRepoWriteOperation(
      '/tmp/repo',
      undefined,
      { repoId: '/tmp/repo', kind: 'fetch', source: 'background' },
      (operation) => async () => {
        operation.start()
        operation.settle({ ok: true, message: 'ok' })
        return { ok: true, message: 'ok' }
      },
    )

    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      query: 'repo-runtime',
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo-linked',
      query: 'repo-runtime',
    })
  })

  test('stops invalidating a repo after it resolves to another write boundary', async () => {
    let linkedBoundary = '/tmp/repo/.git'
    mocks.resolveRepoWriteBoundaryKey.mockImplementation(async (repoId: string) => {
      if (repoId === '/tmp/repo') return '/tmp/repo/.git'
      if (repoId === '/tmp/repo-linked') return linkedBoundary
      return repoId
    })
    await expect(listRepoWriteOperationsForRepo('/tmp/repo-linked')).resolves.toEqual([])
    linkedBoundary = '/tmp/repo-linked/.git'
    await expect(listRepoWriteOperationsForRepo('/tmp/repo-linked')).resolves.toEqual([])
    mocks.publishRepoQueryInvalidation.mockClear()

    await enqueueRepoWriteOperation(
      '/tmp/repo',
      undefined,
      { repoId: '/tmp/repo', kind: 'fetch', source: 'background' },
      (operation) => async () => {
        operation.start()
        operation.settle({ ok: true, message: 'ok' })
        return { ok: true, message: 'ok' }
      },
    )

    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      query: 'repo-runtime',
    })
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalledWith({
      repoId: '/tmp/repo-linked',
      query: 'repo-runtime',
    })
  })

  test('records caller cancellation for a running network operation', async () => {
    const caller = new AbortController()
    let resolveTaskSignal!: (signal: AbortSignal) => void
    const taskSignalReady = new Promise<AbortSignal>((resolve) => {
      resolveTaskSignal = resolve
    })
    const work = enqueueRepoWriteOperation(
      '/tmp/repo',
      caller.signal,
      { repoId: '/tmp/repo', kind: 'fetch', source: 'user' },
      (_operation, context) => async () =>
        await context.runNetworkOperation(
          (signal) =>
            new Promise<{ ok: false; message: string }>((resolve) => {
              resolveTaskSignal(signal)
              signal.addEventListener('abort', () => resolve({ ok: false, message: 'cancelled' }), { once: true })
            }),
        ),
    )

    await vi.waitFor(async () => {
      await expect(listRepoWriteOperationsForRepo('/tmp/repo')).resolves.toMatchObject([
        {
          kind: 'fetch',
          phase: 'running',
        },
      ])
    })

    caller.abort('client disconnected')

    await expect(taskSignalReady).resolves.toMatchObject({ aborted: true })
    await expect(work).resolves.toEqual({ ok: false, message: 'cancelled' })
    await expect(listRepoWriteOperationsForRepo('/tmp/repo', { includeSettled: true })).resolves.toMatchObject([
      {
        kind: 'fetch',
        phase: 'failed',
        cancellation: {
          underlyingRequested: true,
          reason: 'caller-abort',
        },
        error: {
          message: 'cancelled',
          reason: 'caller-abort',
        },
      },
    ])
  })

})
