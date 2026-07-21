import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  enqueueRepoWriteOperation,
  listRepoWriteOperationsForRepo,
  repoWriteOperationCoordinatorStatsForTests,
  resetRepoWriteOperationCoordinatorForTests,
  resolveRepoWriteBoundaryForRead,
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
  resolveRepoWriteBoundaryIdentity: vi.fn(
    async (workspaceId: WorkspaceId, signal?: AbortSignal): Promise<{ coordinationKey: string; repositoryKey: string }> => {
      const key = await mocks.resolveRepoWriteBoundaryKey(workspaceId, signal)
      return { coordinationKey: key, repositoryKey: key }
    },
  ),
  publishRepoQueryInvalidation: vi.fn(),
  validateRepoWriteExecution: vi.fn(async (_execution: unknown, _signal?: AbortSignal) => true),
  workspaceRuntimeClosed: null as
    | ((event: { userId: string; workspaceId: WorkspaceId; workspaceRuntimeId: string }) => void)
    | null,
}))

vi.mock('#/server/modules/repo-source.ts', () => ({
  captureRepoWriteExecution: async (repoId: WorkspaceId, _runtime?: unknown, signal?: AbortSignal) => {
    return await mocks.resolveRepoWriteBoundaryIdentity(repoId, signal)
  },
  repoWriteExecutionBoundaryKey: (capability: { repositoryKey: string }) => capability.repositoryKey,
  repoWriteExecutionCoordinationKey: (capability: { coordinationKey: string }) => capability.coordinationKey,
  resolveRepoWriteBoundaryIdentity: mocks.resolveRepoWriteBoundaryIdentity,
  runWithCapturedRepoWriteExecution: async (
    _capability: unknown,
    task: (source: object) => Promise<unknown>,
  ) => await task({}),
  validateRepoWriteExecution: mocks.validateRepoWriteExecution,
}))

vi.mock('#/server/modules/invalidation-broker.ts', () => ({
  publishRepoQueryInvalidation: mocks.publishRepoQueryInvalidation,
}))

vi.mock('#/server/modules/workspace-runtimes.ts', () => ({
  onWorkspaceRuntimeClosed: (
    listener: (event: { userId: string; workspaceId: WorkspaceId; workspaceRuntimeId: string }) => void,
  ) => {
    mocks.workspaceRuntimeClosed = listener
    return () => {
      if (mocks.workspaceRuntimeClosed === listener) mocks.workspaceRuntimeClosed = null
    }
  },
}))

beforeEach(() => {
  resetRepoWriteOperationCoordinatorForTests()
  mocks.resolveRepoWriteBoundaryKey.mockReset()
  mocks.resolveRepoWriteBoundaryKey.mockImplementation(async (workspaceId) => workspaceId)
  mocks.resolveRepoWriteBoundaryIdentity.mockReset()
  mocks.resolveRepoWriteBoundaryIdentity.mockImplementation(async (workspaceId, signal) => {
    const key = await mocks.resolveRepoWriteBoundaryKey(workspaceId, signal)
    return { coordinationKey: key, repositoryKey: key }
  })
  mocks.publishRepoQueryInvalidation.mockReset()
  mocks.validateRepoWriteExecution.mockReset()
  mocks.validateRepoWriteExecution.mockResolvedValue(true)
  mocks.workspaceRuntimeClosed = null
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

  test('rejects write admission when its workspace runtime closes during boundary capture', async () => {
    const boundary = Promise.withResolvers<string>()
    mocks.resolveRepoWriteBoundaryKey.mockImplementation(async () => await boundary.promise)
    const task = vi.fn(async () => ({ ok: true, message: 'unexpected' }))

    const work = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      {
        repoId: WORKSPACE_ID,
        workspaceRuntimeId: 'runtime-a',
        kind: 'fetch',
        source: 'background',
      },
      () => task,
    )

    mocks.workspaceRuntimeClosed?.({ userId: 'user-a', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-a' })
    boundary.resolve(WORKSPACE_BOUNDARY_KEY)

    await expect(work).rejects.toThrow('error.workspace-runtime-stale')
    expect(task).not.toHaveBeenCalled()
    expect(repoWriteOperationCoordinatorStatsForTests()).toEqual({
      boundaryRuntimes: 0,
      registeredBoundaries: 0,
      registeredRepoIds: 0,
      queuedOperations: 0,
      runningOperations: 0,
    })
  })

  test('rejects read admission when its workspace runtime closes during boundary resolution', async () => {
    const boundary = Promise.withResolvers<string>()
    mocks.resolveRepoWriteBoundaryKey.mockImplementation(async () => await boundary.promise)

    const read = resolveRepoWriteBoundaryForRead(WORKSPACE_ID, { workspaceRuntimeId: 'runtime-a' })

    mocks.workspaceRuntimeClosed?.({ userId: 'user-a', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-a' })
    boundary.resolve(WORKSPACE_BOUNDARY_KEY)

    await expect(read).rejects.toThrow('error.workspace-runtime-stale')
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

  test('records successful fetch state before publishing its settled invalidation', async () => {
    const boundary = await resolveRepoWriteBoundaryForRead(WORKSPACE_ID)
    const observedFetchTimes: Array<number | null> = []
    const { getRepoBoundaryLastFetchAt } = await import('#/server/modules/repo-write-operation-coordinator.ts')
    mocks.publishRepoQueryInvalidation.mockImplementation(() => {
      observedFetchTimes.push(getRepoBoundaryLastFetchAt(boundary))
    })

    await enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      { repoId: WORKSPACE_ID, kind: 'fetch', source: 'background' },
      (operation) => async () => {
        operation.start()
        operation.settle({ ok: true })
        return { ok: true, message: 'fetched' }
      },
    )

    expect(observedFetchTimes.at(-1)).toBe(0)
  })

  test('does not record failed fetches or successful non-fetch operations', async () => {
    const boundary = await resolveRepoWriteBoundaryForRead(WORKSPACE_ID)
    const { getRepoBoundaryLastFetchAt } = await import('#/server/modules/repo-write-operation-coordinator.ts')

    await enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      { repoId: WORKSPACE_ID, kind: 'fetch', source: 'background' },
      (operation) => async () => {
        operation.start()
        operation.settle({ ok: false, message: 'offline' })
        return { ok: false, message: 'offline' }
      },
    )
    await enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      { repoId: WORKSPACE_ID, kind: 'delete-branch', source: 'user' },
      (operation) => async () => {
        operation.start()
        operation.settle({ ok: true })
        return { ok: true, message: 'deleted' }
      },
    )

    expect(getRepoBoundaryLastFetchAt(boundary)).toBeNull()
  })

  test('isolates operation metadata across repository generations while retaining one coordination queue', async () => {
    let repositoryKey = 'repository-generation-a'
    mocks.resolveRepoWriteBoundaryIdentity.mockImplementation(async () => ({
      coordinationKey: WORKSPACE_BOUNDARY_KEY,
      repositoryKey,
    }))
    const { getRepoBoundaryLastFetchAt } = await import('#/server/modules/repo-write-operation-coordinator.ts')

    await enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      { repoId: WORKSPACE_ID, kind: 'fetch', source: 'background' },
      (operation) => async () => {
        operation.start()
        operation.settle({ ok: true })
        return { ok: true, message: 'generation a fetched' }
      },
    )

    repositoryKey = 'repository-generation-b'
    const generationB = await resolveRepoWriteBoundaryForRead(WORKSPACE_ID)

    expect(getRepoBoundaryLastFetchAt(generationB)).toBeNull()
    await expect(listRepoWriteOperationsForRepo(WORKSPACE_ID, { includeSettled: true })).resolves.toEqual([])
  })

  test('reclaims an empty generation group while its shared coordination queue is busy', async () => {
    let workspaceGeneration = 'generation-a'
    mocks.resolveRepoWriteBoundaryIdentity.mockImplementation(async (repoId) => ({
      coordinationKey: WORKSPACE_BOUNDARY_KEY,
      repositoryKey: repoId === WORKSPACE_ID ? workspaceGeneration : 'generation-b',
    }))
    await resolveRepoWriteBoundaryForRead(WORKSPACE_ID)

    const release = Promise.withResolvers<void>()
    const active = enqueueRepoWriteOperation(
      LINKED_WORKSPACE_ID,
      undefined,
      { repoId: LINKED_WORKSPACE_ID, kind: 'fetch', source: 'background' },
      (operation) => async () => {
        operation.start()
        await release.promise
        operation.settle({ ok: true })
        return { ok: true, message: 'done' }
      },
    )
    await vi.waitFor(() => expect(repoWriteOperationCoordinatorStatsForTests().runningOperations).toBe(1))

    workspaceGeneration = 'generation-c'
    await resolveRepoWriteBoundaryForRead(WORKSPACE_ID)

    expect(repoWriteOperationCoordinatorStatsForTests()).toMatchObject({
      boundaryRuntimes: 2,
      registeredBoundaries: 2,
      registeredRepoIds: 2,
      queuedOperations: 0,
      runningOperations: 1,
    })
    release.resolve()
    await active
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

  test('records caller cancellation while validating a captured execution', async () => {
    const caller = new AbortController()
    const validationStarted = Promise.withResolvers<void>()
    mocks.validateRepoWriteExecution.mockImplementation(
      async (_execution: unknown, signal?: AbortSignal) =>
        await new Promise<boolean>((_resolve, reject) => {
          validationStarted.resolve()
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )
    const work = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      caller.signal,
      { repoId: WORKSPACE_ID, kind: 'fetch', source: 'user' },
      (operation, context) => async () => {
        operation.start()
        return await context.runWithRepoSource(async () => ({ ok: true, message: 'unexpected' }))
      },
    )

    await validationStarted.promise
    caller.abort(new Error('client disconnected'))

    await expect(work).resolves.toEqual({ ok: false, message: 'cancelled' })
    await expect(listRepoWriteOperationsForRepo(WORKSPACE_ID, { includeSettled: true })).resolves.toMatchObject([
      {
        phase: 'failed',
        cancellation: { underlyingRequested: true, reason: 'caller-abort' },
        error: { message: 'cancelled', reason: 'caller-abort' },
      },
    ])
  })

  test('rejects a queued write when its workspace runtime closes before execution', async () => {
    const releaseActive = Promise.withResolvers<void>()
    const active = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      { repoId: WORKSPACE_ID, kind: 'fetch', source: 'background' },
      (operation) => async () => {
        operation.start()
        await releaseActive.promise
        operation.settle({ ok: true })
        return { ok: true, message: 'active done' }
      },
    )
    await vi.waitFor(() => expect(repoWriteOperationCoordinatorStatsForTests().runningOperations).toBe(1))

    const queuedTask = vi.fn(async () => ({ ok: true, message: 'unexpected' }))
    const queued = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      {
        repoId: WORKSPACE_ID,
        workspaceRuntimeId: 'runtime-a',
        kind: 'delete-branch',
        source: 'user',
      },
      () => queuedTask,
    )
    await vi.waitFor(() => expect(repoWriteOperationCoordinatorStatsForTests().queuedOperations).toBe(1))

    mocks.workspaceRuntimeClosed?.({ userId: 'user-a', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-a' })
    releaseActive.resolve()

    await expect(active).resolves.toEqual({ ok: true, message: 'active done' })
    await expect(queued).rejects.toThrow('error.workspace-runtime-stale')
    expect(queuedTask).not.toHaveBeenCalled()
    await expect(listRepoWriteOperationsForRepo(WORKSPACE_ID, { includeSettled: true })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'delete-branch',
          phase: 'failed',
          error: expect.objectContaining({ message: 'error.workspace-runtime-stale' }),
        }),
      ]),
    )
  })

  test('reclaims an idle boundary group after its workspace runtime closes', async () => {
    await listRepoWriteOperationsForRepo(WORKSPACE_ID, { workspaceRuntimeId: 'runtime-a' })
    expect(repoWriteOperationCoordinatorStatsForTests()).toMatchObject({
      boundaryRuntimes: 1,
      registeredBoundaries: 1,
      registeredRepoIds: 1,
    })

    mocks.workspaceRuntimeClosed?.({ userId: 'user-a', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-a' })

    expect(repoWriteOperationCoordinatorStatsForTests()).toMatchObject({
      boundaryRuntimes: 0,
      registeredBoundaries: 0,
      registeredRepoIds: 0,
    })
  })

  test('keeps a boundary registered until its final workspace runtime closes', async () => {
    await listRepoWriteOperationsForRepo(WORKSPACE_ID, { workspaceRuntimeId: 'runtime-a' })
    await listRepoWriteOperationsForRepo(WORKSPACE_ID, { workspaceRuntimeId: 'runtime-b' })

    mocks.workspaceRuntimeClosed?.({ userId: 'user-a', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-a' })
    expect(repoWriteOperationCoordinatorStatsForTests()).toMatchObject({
      boundaryRuntimes: 1,
      registeredRepoIds: 1,
    })

    mocks.workspaceRuntimeClosed?.({ userId: 'user-b', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-b' })
    expect(repoWriteOperationCoordinatorStatsForTests()).toMatchObject({
      boundaryRuntimes: 0,
      registeredRepoIds: 0,
    })
  })

  test('reclaims an idle descriptor when a repo resolves to a new boundary', async () => {
    await resolveRepoWriteBoundaryForRead(WORKSPACE_ID)
    mocks.resolveRepoWriteBoundaryKey.mockResolvedValue(LINKED_WORKSPACE_BOUNDARY_KEY)

    await resolveRepoWriteBoundaryForRead(WORKSPACE_ID)

    expect(repoWriteOperationCoordinatorStatsForTests()).toMatchObject({
      boundaryRuntimes: 1,
      registeredBoundaries: 1,
      registeredRepoIds: 1,
    })
  })
})
