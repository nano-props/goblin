import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'
import {
  enqueueRepoWriteOperation,
  getRepoLastSuccessfulFetchAt,
  listRepoWriteOperationsForRepo,
  repoWriteOperationCoordinatorStatsForTests,
  resetRepoWriteOperationCoordinatorForTests,
  resolveRepoWriteBoundaryForRead,
  runWithRepoMembershipReadAdmission,
} from '#/server/modules/repo-write-operation-coordinator.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { RepoWriteExecutionCapability } from '#/server/modules/repo-source.ts'
import { RepoMutationRuntimeFailureError } from '#/server/modules/repo-mutation-runtime-failure.ts'
import { RemoteWorkspaceRuntimeFailureError } from '#/server/modules/remote-workspace-runtime-failure.ts'
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
  publishRepoReadInvalidation: vi.fn(),
  workspaceRuntimeClosed: null as
    ((event: { userId: string; workspaceId: WorkspaceId; workspaceRuntimeId: string }) => void) | null,
  workspaceRuntimeFailed: null as
    ((event: { userId: string; workspaceId: WorkspaceId; workspaceRuntimeId: string }) => void) | null,
}))

vi.mock('#/server/modules/repo-source.ts', () => ({
  captureRepoWriteExecution: async (repoId: WorkspaceId, _runtime?: unknown, signal?: AbortSignal) => {
    return { boundaryKey: await mocks.resolveRepoWriteBoundaryKey(repoId, signal) }
  },
  repoWriteExecutionBoundaryKey: (capability: { boundaryKey: string }) => capability.boundaryKey,
  runWithCapturedRepoWriteExecution: async (_capability: unknown, task: (source: object) => Promise<unknown>) =>
    await task({}),
}))

vi.mock('#/server/modules/repo-write-boundary.ts', () => ({
  resolveRepoWriteBoundaryKey: mocks.resolveRepoWriteBoundaryKey,
}))

vi.mock('#/server/modules/invalidation-broker.ts', () => ({
  publishRepoReadInvalidation: mocks.publishRepoReadInvalidation,
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
  onWorkspaceRuntimeFailed: (
    listener: (event: { userId: string; workspaceId: WorkspaceId; workspaceRuntimeId: string }) => void,
  ) => {
    mocks.workspaceRuntimeFailed = listener
    return () => {
      if (mocks.workspaceRuntimeFailed === listener) mocks.workspaceRuntimeFailed = null
    }
  },
}))

beforeEach(() => {
  resetRepoWriteOperationCoordinatorForTests()
  mocks.resolveRepoWriteBoundaryKey.mockReset()
  mocks.resolveRepoWriteBoundaryKey.mockImplementation(async (workspaceId) => workspaceId)
  mocks.publishRepoReadInvalidation.mockReset()
  mocks.workspaceRuntimeClosed = null
  mocks.workspaceRuntimeFailed = null
  useFakeTimers()
  vi.setSystemTime(0)
})

describe('repo write operation coordinator', () => {
  test('rejects successful overlapping reads without replacing a read failure', async () => {
    const boundary = await resolveRepoWriteBoundaryForRead(WORKSPACE_ID)
    const releaseRead = Promise.withResolvers<void>()
    const readStarted = Promise.withResolvers<void>()
    const overlappingRead = runWithRepoMembershipReadAdmission(boundary, async () => {
      readStarted.resolve()
      await releaseRead.promise
      throw new Error('worktree disappeared while sampling status')
    })
    await readStarted.promise
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const followupStarted = Promise.withResolvers<void>()
    const releaseFollowup = Promise.withResolvers<void>()
    const work = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      {
        repoId: WORKSPACE_ID,
        kind: 'create-worktree',
        source: 'user',
        target: { branch: 'feature/creating', worktreePath: '/workspace-creating' },
      },
      (operation) => async () => {
        operation.start()
        await operation.runMembershipMutation(async () => {
          started.resolve()
          await release.promise
        })
        followupStarted.resolve()
        await releaseFollowup.promise
        operation.settle({ ok: true })
        return { ok: true, message: 'created' }
      },
    )

    await started.promise
    await expect(runWithRepoMembershipReadAdmission(boundary, async () => 'snapshot')).rejects.toThrow(
      'error.repo-membership-changing',
    )
    expect(mocks.publishRepoReadInvalidation).not.toHaveBeenCalledWith({
      repoId: WORKSPACE_ID,
      domain: 'metadata',
    })

    release.resolve()
    await followupStarted.promise
    expect(mocks.publishRepoReadInvalidation).not.toHaveBeenCalledWith({
      repoId: WORKSPACE_ID,
      domain: 'worktree-status',
    })
    releaseRead.resolve()
    await expect(overlappingRead).rejects.toThrow('worktree disappeared while sampling status')

    await expect(runWithRepoMembershipReadAdmission(boundary, async () => 'stable')).resolves.toBe('stable')
    releaseFollowup.resolve()
    await expect(work).resolves.toEqual({ ok: true, message: 'created' })
  })

  test('keeps membership admission on one physical boundary after its runtime closes', async () => {
    mocks.resolveRepoWriteBoundaryKey.mockResolvedValue(WORKSPACE_BOUNDARY_KEY)
    const boundary = await resolveRepoWriteBoundaryForRead(WORKSPACE_ID, { workspaceRuntimeId: 'runtime-a' })
    const readStarted = Promise.withResolvers<void>()
    const releaseRead = Promise.withResolvers<void>()
    const read = runWithRepoMembershipReadAdmission(boundary, async () => {
      readStarted.resolve()
      await releaseRead.promise
      return 'stale snapshot'
    })
    await readStarted.promise

    mocks.workspaceRuntimeClosed?.({ userId: 'user-a', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-a' })

    const mutation = enqueueRepoWriteOperation(
      LINKED_WORKSPACE_ID,
      undefined,
      { repoId: LINKED_WORKSPACE_ID, kind: 'create-worktree', source: 'user' },
      (operation) => async () => {
        operation.start()
        await operation.runMembershipMutation(async () => {})
        operation.settle({ ok: true })
        return { ok: true, message: 'created' }
      },
    )
    await expect(mutation).resolves.toEqual({ ok: true, message: 'created' })

    releaseRead.resolve()
    await expect(read).rejects.toThrow('error.repo-membership-changing')
  })

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

  test('registers runtime admission before a specialized execution capture starts', async () => {
    const capture = Promise.withResolvers<RepoWriteExecutionCapability>()
    const task = vi.fn(async () => ({ ok: true, message: 'unexpected' }))
    const work = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      {
        repoId: WORKSPACE_ID,
        workspaceRuntimeId: 'runtime-a',
        kind: 'remove-worktree',
        source: 'user',
        captureExecution: async () => await capture.promise,
      },
      () => task,
    )

    mocks.workspaceRuntimeClosed?.({ userId: 'user-a', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-a' })
    capture.resolve({
      boundaryKey: WORKSPACE_BOUNDARY_KEY,
    } as unknown as RepoWriteExecutionCapability)

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

  test('keeps runtime closure authoritative when specialized execution capture also fails', async () => {
    const capture = Promise.withResolvers<RepoWriteExecutionCapability>()
    const work = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      {
        repoId: WORKSPACE_ID,
        workspaceRuntimeId: 'runtime-a',
        kind: 'remove-worktree',
        source: 'user',
        captureExecution: async () => await capture.promise,
      },
      () => async () => ({ ok: true, message: 'unexpected' }),
    )

    mocks.workspaceRuntimeClosed?.({ userId: 'user-a', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-a' })
    capture.reject(new Error('capture failed'))

    await expect(work).rejects.toThrow('error.workspace-runtime-stale')
    expect(repoWriteOperationCoordinatorStatsForTests()).toMatchObject({
      boundaryRuntimes: 0,
      registeredBoundaries: 0,
      registeredRepoIds: 0,
    })
  })

  test('keeps runtime closure authoritative when it also aborts specialized capture', async () => {
    const captureSignal = new AbortController()
    const work = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      captureSignal.signal,
      {
        repoId: WORKSPACE_ID,
        workspaceRuntimeId: 'runtime-a',
        kind: 'remove-worktree',
        source: 'user',
        captureExecution: async (signal) =>
          await new Promise<RepoWriteExecutionCapability>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          }),
      },
      () => async () => ({ ok: true, message: 'unexpected' }),
    )

    mocks.workspaceRuntimeClosed?.({ userId: 'user-a', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-a' })
    captureSignal.abort(new Error('error.workspace-runtime-stale'))

    await expect(work).rejects.toThrow('error.workspace-runtime-stale')
    expect(repoWriteOperationCoordinatorStatsForTests()).toMatchObject({
      boundaryRuntimes: 0,
      registeredBoundaries: 0,
      registeredRepoIds: 0,
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
    vi.setSystemTime(1_000)
    for (let index = 0; index < 105; index += 1) {
      if (index === 100) mocks.publishRepoReadInvalidation.mockClear()
      const workspaceId = workspaceIdForTest(`goblin+file:///workspace-${index}`)
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
    expect(mocks.publishRepoReadInvalidation).toHaveBeenCalledWith({
      repoId: workspaceIdForTest('goblin+file:///workspace-0'),
      domain: 'operations',
    })
  })

  test('uses settlement order when bounded operations share a timestamp', async () => {
    vi.setSystemTime(2_000)
    let releaseOldest!: () => void
    const oldestCreatedWorkspace = workspaceIdForTest('goblin+file:///oldest-created')
    const oldestCreated = enqueueRepoWriteOperation(
      oldestCreatedWorkspace,
      undefined,
      { repoId: oldestCreatedWorkspace, kind: 'fetch', source: 'background' },
      (operation) => async () => {
        operation.start()
        await new Promise<void>((resolve) => {
          releaseOldest = resolve
        })
        operation.settle({ ok: false, message: 'latest failure' })
        return { ok: false, message: 'latest failure' }
      },
    )
    await vi.waitFor(() => expect(releaseOldest).toBeTypeOf('function'))

    for (let index = 0; index < 100; index += 1) {
      const workspaceId = workspaceIdForTest(`goblin+file:///settled-first-${index}`)
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

    releaseOldest()
    await oldestCreated

    await expect(
      listRepoWriteOperationsForRepo(oldestCreatedWorkspace, { includeSettled: true }),
    ).resolves.toMatchObject([{ phase: 'failed', error: { message: 'latest failure' } }])
    await expect(
      listRepoWriteOperationsForRepo(workspaceIdForTest('goblin+file:///settled-first-0'), {
        includeSettled: true,
      }),
    ).resolves.toEqual([])
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
    await resolveRepoWriteBoundaryForRead(WORKSPACE_ID)
    const observedFetchTimes: Array<number | null> = []
    mocks.publishRepoReadInvalidation.mockImplementation(() => {
      observedFetchTimes.push(getRepoLastSuccessfulFetchAt(WORKSPACE_ID))
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
    await resolveRepoWriteBoundaryForRead(WORKSPACE_ID)

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

    expect(getRepoLastSuccessfulFetchAt(WORKSPACE_ID)).toBeNull()
  })

  test('publishes repo-runtime invalidations to known sibling repos sharing a write boundary', async () => {
    mocks.resolveRepoWriteBoundaryKey.mockImplementation(async (workspaceId) =>
      workspaceId === WORKSPACE_ID || workspaceId === LINKED_WORKSPACE_ID ? WORKSPACE_BOUNDARY_KEY : workspaceId,
    )
    await resolveRepoWriteBoundaryForRead(LINKED_WORKSPACE_ID)
    mocks.publishRepoReadInvalidation.mockClear()

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

    expect(mocks.publishRepoReadInvalidation).toHaveBeenCalledWith({
      repoId: WORKSPACE_ID,
      domain: 'operations',
    })
    expect(mocks.publishRepoReadInvalidation).toHaveBeenCalledWith({
      repoId: LINKED_WORKSPACE_ID,
      domain: 'operations',
    })
    await expect(listRepoWriteOperationsForRepo(LINKED_WORKSPACE_ID, { includeSettled: true })).resolves.toEqual([
      expect.objectContaining({ repoId: WORKSPACE_ID, kind: 'fetch', phase: 'done' }),
    ])
    expect(getRepoLastSuccessfulFetchAt(LINKED_WORKSPACE_ID)).toBe(0)
  })

  test('invalidates a cold sibling impact without binding or probing during an operations read', async () => {
    mocks.resolveRepoWriteBoundaryKey.mockImplementation(async (workspaceId) =>
      workspaceId === WORKSPACE_ID || workspaceId === LINKED_WORKSPACE_ID ? WORKSPACE_BOUNDARY_KEY : workspaceId,
    )
    await enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      {
        repoId: WORKSPACE_ID,
        workspaceRuntimeId: 'runtime-source',
        kind: 'fetch',
        source: 'background',
      },
      (operation) => async () => {
        operation.start()
        const result = {
          ok: true as const,
          message: 'fetched',
          repoIdsToInvalidate: [WORKSPACE_ID, LINKED_WORKSPACE_ID],
        }
        operation.settle(result)
        return result
      },
    )

    expect(mocks.publishRepoReadInvalidation).toHaveBeenCalledWith({
      repoId: LINKED_WORKSPACE_ID,
      domain: 'operations',
    })
    mocks.resolveRepoWriteBoundaryKey.mockClear()
    await expect(
      listRepoWriteOperationsForRepo(LINKED_WORKSPACE_ID, {
        includeSettled: true,
        workspaceRuntimeId: 'runtime-source',
      }),
    ).resolves.toEqual([])
    expect(getRepoLastSuccessfulFetchAt(LINKED_WORKSPACE_ID)).toBeNull()
    expect(mocks.resolveRepoWriteBoundaryKey).not.toHaveBeenCalled()
  })

  test('filters sibling operations owned by another workspace runtime', async () => {
    mocks.resolveRepoWriteBoundaryKey.mockResolvedValue(WORKSPACE_BOUNDARY_KEY)
    await enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      {
        repoId: WORKSPACE_ID,
        workspaceRuntimeId: 'runtime-source',
        kind: 'delete-branch',
        source: 'user',
      },
      (operation) => async () => {
        operation.start()
        const result = {
          ok: true as const,
          message: 'deleted',
          repoIdsToInvalidate: [WORKSPACE_ID, LINKED_WORKSPACE_ID],
        }
        operation.settle(result)
        return result
      },
    )

    await expect(
      listRepoWriteOperationsForRepo(LINKED_WORKSPACE_ID, {
        includeSettled: true,
        workspaceRuntimeId: 'runtime-linked',
      }),
    ).resolves.toEqual([])
  })

  test('stops invalidating a repo after it resolves to another write boundary', async () => {
    let linkedBoundary = WORKSPACE_BOUNDARY_KEY
    mocks.resolveRepoWriteBoundaryKey.mockImplementation(async (workspaceId) => {
      if (workspaceId === WORKSPACE_ID) return WORKSPACE_BOUNDARY_KEY
      if (workspaceId === LINKED_WORKSPACE_ID) return linkedBoundary
      return workspaceId
    })
    await resolveRepoWriteBoundaryForRead(LINKED_WORKSPACE_ID)
    linkedBoundary = LINKED_WORKSPACE_BOUNDARY_KEY
    await resolveRepoWriteBoundaryForRead(LINKED_WORKSPACE_ID)
    mocks.publishRepoReadInvalidation.mockClear()

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

    expect(mocks.publishRepoReadInvalidation).toHaveBeenCalledWith({
      repoId: WORKSPACE_ID,
      domain: 'operations',
    })
    expect(mocks.publishRepoReadInvalidation).not.toHaveBeenCalledWith({
      repoId: LINKED_WORKSPACE_ID,
      domain: 'operations',
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

  test('returns cancellation when a running network operation rejects on abort', async () => {
    const caller = new AbortController()
    const taskStarted = Promise.withResolvers<void>()
    const work = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      caller.signal,
      { repoId: WORKSPACE_ID, kind: 'fetch', source: 'user' },
      (_operation, context) => async () =>
        await context.runNetworkOperation(
          (signal) =>
            new Promise<{ ok: true; message: string }>((_resolve, reject) => {
              taskStarted.resolve()
              signal.addEventListener('abort', () => reject(signal.reason), { once: true })
            }),
        ),
    )

    await taskStarted.promise
    caller.abort(new Error('client disconnected'))

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

  test('preserves a non-cancellation failure observed after caller abort', async () => {
    const caller = new AbortController()
    const taskStarted = Promise.withResolvers<void>()
    const rejectTask = Promise.withResolvers<never>()
    const runtimeFailure = new Error('typed runtime failure')
    const work = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      caller.signal,
      { repoId: WORKSPACE_ID, kind: 'fetch', source: 'user' },
      (_operation, context) => async () =>
        await context.runNetworkOperation(async () => {
          taskStarted.resolve()
          return await rejectTask.promise
        }),
    )

    await taskStarted.promise
    caller.abort(new DOMException('caller aborted', 'AbortError'))
    rejectTask.reject(runtimeFailure)

    await expect(work).rejects.toBe(runtimeFailure)
  })

  test('retains the write lease until an aborted network operation has drained', async () => {
    await resolveRepoWriteBoundaryForRead(WORKSPACE_ID)
    const caller = new AbortController()
    const firstStarted = Promise.withResolvers<void>()
    const releaseFirst = Promise.withResolvers<void>()
    const secondTask = vi.fn(async () => ({ ok: true, message: 'second complete' }))
    const first = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      caller.signal,
      { repoId: WORKSPACE_ID, kind: 'fetch', source: 'user' },
      (_operation, context) => async () =>
        await context.runNetworkOperation(async () => {
          firstStarted.resolve()
          await releaseFirst.promise
          return { ok: true, message: 'first drained' }
        }),
    )

    await firstStarted.promise
    caller.abort(new Error('client disconnected'))
    const second = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      { repoId: WORKSPACE_ID, kind: 'delete-branch', source: 'user' },
      (operation) => async () => {
        operation.start()
        const result = await secondTask()
        operation.settle(result)
        return result
      },
    )

    await vi.waitFor(() => expect(repoWriteOperationCoordinatorStatsForTests().queuedOperations).toBe(1))
    expect(secondTask).not.toHaveBeenCalled()

    releaseFirst.resolve()
    await expect(first).resolves.toEqual({ ok: true, message: 'first drained' })
    await expect(second).resolves.toEqual({ ok: true, message: 'second complete' })
    expect(secondTask).toHaveBeenCalledOnce()
    expect(getRepoLastSuccessfulFetchAt(WORKSPACE_ID)).not.toBeNull()
    await expect(listRepoWriteOperationsForRepo(WORKSPACE_ID, { includeSettled: true })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'fetch',
          phase: 'done',
          cancellation: expect.objectContaining({ underlyingRequested: true, reason: 'caller-abort' }),
          error: null,
        }),
      ]),
    )
  })

  test('preserves an execution failure after runtime admission has completed', async () => {
    const taskStarted = Promise.withResolvers<void>()
    const taskResult = Promise.withResolvers<{ ok: true; message: string }>()
    const work = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      {
        repoId: WORKSPACE_ID,
        workspaceRuntimeId: 'runtime-a',
        kind: 'remove-worktree',
        source: 'user',
      },
      (operation, context) => async () => {
        operation.start()
        return await context.runWithRepoSource(async () => {
          taskStarted.resolve()
          return await taskResult.promise
        })
      },
    )

    await taskStarted.promise
    mocks.workspaceRuntimeClosed?.({ userId: 'user-a', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-a' })
    taskResult.reject(new Error('disk failure'))

    await expect(work).rejects.toThrow('disk failure')
    await expect(listRepoWriteOperationsForRepo(WORKSPACE_ID, { includeSettled: true })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'remove-worktree',
          phase: 'failed',
          error: expect.objectContaining({ message: 'disk failure' }),
        }),
      ]),
    )
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

  test('closes runtime admission before a classified failure releases the write queue', async () => {
    const releaseActive = Promise.withResolvers<void>()
    const active = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      {
        repoId: WORKSPACE_ID,
        workspaceRuntimeId: 'runtime-a',
        kind: 'pull',
        source: 'user',
      },
      (operation) => async () => {
        operation.start()
        await releaseActive.promise
        throw new RepoMutationRuntimeFailureError(
          {
            ok: false,
            message: 'transport failed',
            repoIdsToInvalidate: [WORKSPACE_ID, LINKED_WORKSPACE_ID],
          },
          new RemoteWorkspaceRuntimeFailureError({
            workspaceId: WORKSPACE_ID,
            workspaceRuntimeId: 'runtime-a',
            reason: 'unreachable',
          }),
        )
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

    releaseActive.resolve()

    await expect(active).rejects.toBeInstanceOf(RepoMutationRuntimeFailureError)
    await expect(queued).rejects.toThrow('error.workspace-runtime-stale')
    expect(queuedTask).not.toHaveBeenCalled()
    expect(mocks.publishRepoReadInvalidation).toHaveBeenCalledWith({
      repoId: LINKED_WORKSPACE_ID,
      domain: 'operations',
    })
    await expect(
      listRepoWriteOperationsForRepo(LINKED_WORKSPACE_ID, {
        includeSettled: true,
        workspaceRuntimeId: 'runtime-a',
      }),
    ).resolves.toEqual([])
  })

  test('closes runtime admission for a classified queued-task failure before releasing the queue', async () => {
    const releaseActive = Promise.withResolvers<void>()
    const runtimeFailure = new RemoteWorkspaceRuntimeFailureError({
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-a',
      reason: 'unreachable',
    })
    const active = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      undefined,
      {
        repoId: WORKSPACE_ID,
        workspaceRuntimeId: 'runtime-a',
        kind: 'pull',
        source: 'user',
      },
      () => async () => {
        await releaseActive.promise
        throw runtimeFailure
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

    releaseActive.resolve()

    await expect(active).rejects.toBe(runtimeFailure)
    await expect(queued).rejects.toThrow('error.workspace-runtime-stale')
    expect(queuedTask).not.toHaveBeenCalled()
  })

  test('closes runtime admission when execution capture observes a classified failure', async () => {
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

    const captureStarted = Promise.withResolvers<void>()
    const rejectCapture = Promise.withResolvers<RepoWriteExecutionCapability>()
    const caller = new AbortController()
    const runtimeFailure = new RemoteWorkspaceRuntimeFailureError({
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-a',
      reason: 'unreachable',
    })
    const failedCapture = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      caller.signal,
      {
        repoId: WORKSPACE_ID,
        workspaceRuntimeId: 'runtime-a',
        kind: 'push',
        source: 'user',
        captureExecution: async () => {
          captureStarted.resolve()
          return await rejectCapture.promise
        },
      },
      () => async () => ({ ok: true, message: 'unexpected' }),
    )
    await captureStarted.promise
    caller.abort(new Error('caller disconnected'))
    rejectCapture.reject(runtimeFailure)

    await expect(failedCapture).rejects.toBe(runtimeFailure)
    releaseActive.resolve()
    await expect(active).resolves.toEqual({ ok: true, message: 'active done' })
    await expect(queued).rejects.toThrow('error.workspace-runtime-stale')
    expect(queuedTask).not.toHaveBeenCalled()
  })

  test('keeps runtime admission open when execution capture is only cancelled', async () => {
    const captureStarted = Promise.withResolvers<void>()
    const rejectCapture = Promise.withResolvers<RepoWriteExecutionCapability>()
    const caller = new AbortController()
    const cancelledCapture = enqueueRepoWriteOperation(
      WORKSPACE_ID,
      caller.signal,
      {
        repoId: WORKSPACE_ID,
        workspaceRuntimeId: 'runtime-a',
        kind: 'push',
        source: 'user',
        captureExecution: async () => {
          captureStarted.resolve()
          return await rejectCapture.promise
        },
      },
      () => async () => ({ ok: true, message: 'unexpected' }),
    )
    await captureStarted.promise
    caller.abort(new Error('caller cancelled'))
    rejectCapture.reject(caller.signal.reason)

    await expect(cancelledCapture).resolves.toEqual({ ok: false, message: 'cancelled' })
    await expect(
      enqueueRepoWriteOperation(
        WORKSPACE_ID,
        undefined,
        {
          repoId: WORKSPACE_ID,
          workspaceRuntimeId: 'runtime-a',
          kind: 'fetch',
          source: 'user',
        },
        (operation) => async () => {
          operation.start()
          operation.settle({ ok: true })
          return { ok: true, message: 'next admitted' }
        },
      ),
    ).resolves.toEqual({ ok: true, message: 'next admitted' })
  })

  test('reclaims an idle boundary group after its workspace runtime closes', async () => {
    await resolveRepoWriteBoundaryForRead(WORKSPACE_ID, { workspaceRuntimeId: 'runtime-a' })
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
    await resolveRepoWriteBoundaryForRead(WORKSPACE_ID, { workspaceRuntimeId: 'runtime-a' })
    await resolveRepoWriteBoundaryForRead(WORKSPACE_ID, { workspaceRuntimeId: 'runtime-b' })

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
