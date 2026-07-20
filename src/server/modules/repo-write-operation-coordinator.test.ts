import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  enqueueRepoWriteOperation,
  listRepoWriteOperationsForRepo,
  repoWriteOperationCoordinatorStatsForTests,
  resetRepoWriteOperationCoordinatorForTests,
} from '#/server/modules/repo-write-operation-coordinator.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')
const LINKED_WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace-linked')
const SLOW_WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace-slow')
const FAST_WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace-fast')
const WORKSPACE_BOUNDARY_KEY = '/workspace/.git'
const LINKED_WORKSPACE_BOUNDARY_KEY = '/workspace-linked/.git'

const mocks = vi.hoisted(() => ({
  resolveRepoWriteBoundaryKey: vi.fn(
    async (workspaceId: WorkspaceId, _signal?: AbortSignal): Promise<string> => workspaceId,
  ),
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
  mocks.resolveRepoWriteBoundaryKey.mockImplementation(async (workspaceId) => workspaceId)
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
    mocks.resolveRepoWriteBoundaryKey.mockImplementation(async (workspaceId) => {
      if (workspaceId === SLOW_WORKSPACE_ID) return await slowBoundary.promise
      return workspaceId
    })
    const slowWork = enqueueRepoWriteOperation(
      SLOW_WORKSPACE_ID,
      undefined,
      { repoId: SLOW_WORKSPACE_ID, kind: 'fetch', source: 'background' },
      (operation) => async () => {
        operation.start()
        operation.settle({ ok: true })
        return { ok: true, message: 'slow' }
      },
    )

    await expect(
      enqueueRepoWriteOperation(
        FAST_WORKSPACE_ID,
        undefined,
        { repoId: FAST_WORKSPACE_ID, kind: 'fetch', source: 'background' },
        (operation) => async () => {
          operation.start()
          operation.settle({ ok: true })
          return { ok: true, message: 'fast' }
        },
      ),
    ).resolves.toEqual({ ok: true, message: 'fast' })

    slowBoundary.resolve('/workspace-slow/.git')
    await expect(slowWork).resolves.toEqual({ ok: true, message: 'slow' })
  })

  test('does not register an operation when boundary resolution is aborted', async () => {
    const caller = new AbortController()
    mocks.resolveRepoWriteBoundaryKey.mockImplementation(
      async (_workspaceId, signal?: AbortSignal) =>
        await new Promise<string>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        }),
    )

    const work = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      caller.signal,
      { repoId: WORKSPACE_ID, kind: 'fetch', source: 'background' },
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
    mocks.resolveRepoWriteBoundaryKey.mockResolvedValue(WORKSPACE_BOUNDARY_KEY)
    const releaseFirst = Promise.withResolvers<void>()
    const order: string[] = []
    const first = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      { repoId: WORKSPACE_ID, kind: 'fetch', source: 'background' },
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
      LINKED_WORKSPACE_ID,
      undefined,
      { repoId: LINKED_WORKSPACE_ID, kind: 'fetch', source: 'background' },
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
        WORKSPACE_ID,
        undefined,
        { repoId: WORKSPACE_ID, kind: 'delete-branch', source: 'user' },
        (operation) => async () => {
          operation.start()
          throw new Error('boom')
        },
      ),
    ).rejects.toThrow('boom')

    await expect(listRepoWriteOperationsForRepo(WORKSPACE_ID, { includeSettled: true })).resolves.toMatchObject([
      {
        repoId: WORKSPACE_ID,
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
      WORKSPACE_ID,
      undefined,
      { repoId: WORKSPACE_ID, kind: 'fetch', source: 'background' },
      (operation) => async () => {
        operation.start()
        operation.settle({ ok: true, message: 'repo-scoped' })
        return { ok: true, message: 'repo-scoped' }
      },
    )
    await enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      { repoId: WORKSPACE_ID, workspaceRuntimeId: 'repo-runtime-current', kind: 'delete-branch', source: 'user' },
      (operation) => async () => {
        operation.start()
        operation.settle({ ok: true, message: 'current' })
        return { ok: true, message: 'current' }
      },
    )
    await enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      { repoId: WORKSPACE_ID, workspaceRuntimeId: 'repo-runtime-stale', kind: 'remove-worktree', source: 'user' },
      (operation) => async () => {
        operation.start()
        operation.settle({ ok: true, message: 'stale' })
        return { ok: true, message: 'stale' }
      },
    )

    await expect(
      listRepoWriteOperationsForRepo(WORKSPACE_ID, {
        workspaceRuntimeId: 'repo-runtime-current',
        includeSettled: true,
      }),
    ).resolves.toMatchObject([
      { kind: 'fetch', workspaceRuntimeId: null },
      { kind: 'delete-branch', workspaceRuntimeId: 'repo-runtime-current' },
    ])
  })

  test('keeps settled write operations globally bounded', async () => {
    for (let index = 0; index < 105; index += 1) {
      const workspaceId = workspaceIdForTest(`goblin+file:///workspace-${index}`)
      vi.setSystemTime(1_000 + index)
      await enqueueRepoWriteOperation(
        workspaceId,
        undefined,
        { repoId: workspaceId, kind: 'fetch', source: 'background' },
        (operation) => async () => {
          operation.start()
          operation.settle({ ok: true, message: 'ok' })
          return { ok: true, message: 'ok' }
        },
      )
    }

    await expect(listRepoWriteOperationsForRepo(undefined, { includeSettled: true })).resolves.toHaveLength(100)
    await expect(
      listRepoWriteOperationsForRepo(workspaceIdForTest('goblin+file:///workspace-0'), { includeSettled: true }),
    ).resolves.toEqual([])
    await expect(
      listRepoWriteOperationsForRepo(workspaceIdForTest('goblin+file:///workspace-104'), { includeSettled: true }),
    ).resolves.toMatchObject([
      { repoId: workspaceIdForTest('goblin+file:///workspace-104'), kind: 'fetch', phase: 'done' },
    ])
  })

  test('runs cancellable network operations inside the repo write runtime', async () => {
    let resolveFetch!: (value: { ok: true; message: string }) => void
    const work = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      { repoId: WORKSPACE_ID, kind: 'fetch', source: 'background' },
      (_operation, context) => async () =>
        await context.runNetworkOperation(
          () =>
            new Promise<{ ok: true; message: string }>((resolve) => {
              resolveFetch = resolve
            }),
        ),
    )

    await vi.waitFor(async () => {
      await expect(listRepoWriteOperationsForRepo(WORKSPACE_ID)).resolves.toMatchObject([
        {
          repoId: WORKSPACE_ID,
          kind: 'fetch',
          phase: 'running',
          source: 'background',
        },
      ])
    })

    resolveFetch({ ok: true, message: 'ok' })
    await expect(work).resolves.toEqual({ ok: true, message: 'ok' })
    await expect(listRepoWriteOperationsForRepo(WORKSPACE_ID)).resolves.toEqual([])
    await expect(listRepoWriteOperationsForRepo(WORKSPACE_ID, { includeSettled: true })).resolves.toMatchObject([
      {
        kind: 'fetch',
        phase: 'done',
        error: null,
      },
    ])
  })

  test('publishes repo-runtime invalidations to known sibling repos sharing a write boundary', async () => {
    mocks.resolveRepoWriteBoundaryKey.mockImplementation(async (workspaceId) =>
      workspaceId === WORKSPACE_ID || workspaceId === LINKED_WORKSPACE_ID ? WORKSPACE_BOUNDARY_KEY : workspaceId,
    )
    await expect(listRepoWriteOperationsForRepo(LINKED_WORKSPACE_ID)).resolves.toEqual([])
    mocks.publishRepoQueryInvalidation.mockClear()

    await enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      { repoId: WORKSPACE_ID, kind: 'fetch', source: 'background' },
      (operation) => async () => {
        operation.start()
        operation.settle({ ok: true, message: 'ok' })
        return { ok: true, message: 'ok' }
      },
    )

    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: WORKSPACE_ID,
      query: 'repo-runtime',
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: LINKED_WORKSPACE_ID,
      query: 'repo-runtime',
    })
  })

  test('stops invalidating a repo after it resolves to another write boundary', async () => {
    let linkedBoundary = WORKSPACE_BOUNDARY_KEY
    mocks.resolveRepoWriteBoundaryKey.mockImplementation(async (workspaceId) => {
      if (workspaceId === WORKSPACE_ID) return WORKSPACE_BOUNDARY_KEY
      if (workspaceId === LINKED_WORKSPACE_ID) return linkedBoundary
      return workspaceId
    })
    await expect(listRepoWriteOperationsForRepo(LINKED_WORKSPACE_ID)).resolves.toEqual([])
    linkedBoundary = LINKED_WORKSPACE_BOUNDARY_KEY
    await expect(listRepoWriteOperationsForRepo(LINKED_WORKSPACE_ID)).resolves.toEqual([])
    mocks.publishRepoQueryInvalidation.mockClear()

    await enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      { repoId: WORKSPACE_ID, kind: 'fetch', source: 'background' },
      (operation) => async () => {
        operation.start()
        operation.settle({ ok: true, message: 'ok' })
        return { ok: true, message: 'ok' }
      },
    )

    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: WORKSPACE_ID,
      query: 'repo-runtime',
    })
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalledWith({
      repoId: LINKED_WORKSPACE_ID,
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
      WORKSPACE_ID,
      caller.signal,
      { repoId: WORKSPACE_ID, kind: 'fetch', source: 'user' },
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
      await expect(listRepoWriteOperationsForRepo(WORKSPACE_ID)).resolves.toMatchObject([
        {
          kind: 'fetch',
          phase: 'running',
        },
      ])
    })

    caller.abort('client disconnected')

    await expect(taskSignalReady).resolves.toMatchObject({ aborted: true })
    await expect(work).resolves.toEqual({ ok: false, message: 'cancelled' })
    await expect(listRepoWriteOperationsForRepo(WORKSPACE_ID, { includeSettled: true })).resolves.toMatchObject([
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
