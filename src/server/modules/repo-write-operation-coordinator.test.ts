import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  abortRepoWriteNetworkOperation,
  enqueueRepoWriteOperation,
  listRepoWriteOperationsForRepo,
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
