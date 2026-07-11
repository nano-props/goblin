import { CancelledError } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { runExclusiveOperation, runLatestOperation } from '#/web/stores/repos/operation-runner.ts'
import { repoOperation, repoOperationBusy } from '#/web/stores/repos/repo-operation-scheduler.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore, seedRepoShellForTest } from '#/web/test-utils/bridge.ts'
const REPO_ID = '/tmp/goblin-operation-runner-test-repo'

beforeEach(() => {
  resetReposStore()
  seedRepoShellForTest({ id: REPO_ID, repoRuntimeId: 'repo-runtime-test' })
})

describe('runLatestOperation', () => {
  test('replaces older queued operations before they start', async () => {
    const starts: string[] = []
    let releaseActive!: () => void
    const active = runLatestOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'network',
      operationKey: 'visible-status',
      priority: 1,
      targets: [{ key: 'visibleStatus', reason: 'visible-status' }],
      task: () =>
        new Promise<string>((resolve) => {
          starts.push('active')
          releaseActive = () => resolve('active')
        }),
    })
    const replaced = runLatestOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'network',
      operationKey: 'visible-status',
      priority: 1,
      targets: [{ key: 'visibleStatus', reason: 'visible-status' }],
      task: async () => {
        starts.push('replaced')
        return 'replaced'
      },
    })
    const latest = runLatestOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'network',
      operationKey: 'visible-status',
      priority: 1,
      targets: [{ key: 'visibleStatus', reason: 'visible-status' }],
      task: async () => {
        starts.push('latest')
        return 'latest'
      },
    })

    expect(repoOperation(REPO_ID, 'visibleStatus').phase).toBe('queued')
    expect(useReposStore.getState().repos[REPO_ID]?.operations.visibleStatus.phase).toBe('queued')
    releaseActive()

    await expect(active).resolves.toBeNull()
    await expect(replaced).resolves.toBeNull()
    await expect(latest).resolves.toBe('latest')
    expect(starts).toEqual(['active', 'latest'])
    expect(repoOperation(REPO_ID, 'visibleStatus').phase).toBe('idle')
    expect(useReposStore.getState().repos[REPO_ID]?.operations.visibleStatus.phase).toBe('idle')
  })
})

describe('runExclusiveOperation', () => {
  test('stays running until the result completion barrier settles', async () => {
    let releaseBarrier!: () => void
    const events: string[] = []
    const work = runExclusiveOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'write',
      priority: 1,
      targets: [{ key: 'branchAction', reason: 'branch:createWorktree', target: 'feature/new' }],
      task: async () => {
        events.push('task')
        return 'ok'
      },
      completionBarrier: (result) =>
        new Promise<void>((resolve) => {
          events.push(`barrier:${result}`)
          releaseBarrier = resolve
        }),
      onResult: () => {
        events.push('result')
      },
    })

    await vi.waitFor(() => expect(events).toEqual(['task', 'barrier:ok']))
    expect(repoOperation(REPO_ID, 'branchAction')).toMatchObject({
      phase: 'running',
      target: 'feature/new',
    })

    releaseBarrier()
    await expect(work).resolves.toBe('ok')

    expect(events).toEqual(['task', 'barrier:ok', 'result'])
    expect(repoOperation(REPO_ID, 'branchAction')).toMatchObject({ phase: 'idle', target: null })
  })

  test('marks and settles all targets together', async () => {
    let release!: () => void
    const work = runExclusiveOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'network',
      priority: 1,
      targets: [
        { key: 'branchAction', reason: 'branch:pull', target: 'feature/a' },
        { key: 'fetch', reason: 'pull' },
      ],
      task: () =>
        new Promise<string>((resolve) => {
          release = () => resolve('ok')
        }),
    })

    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('running')
    expect(repoOperation(REPO_ID, 'fetch').phase).toBe('running')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBe('feature/a')
    expect(repoOperation(REPO_ID, 'fetch').target).toBeNull()
    expect(repoOperationBusy(REPO_ID, 'branchAction')).toBe(true)
    expect(useReposStore.getState().repos[REPO_ID]?.operations.branchAction).toMatchObject({
      phase: 'running',
      reason: 'branch:pull',
      target: 'feature/a',
    })
    expect(useReposStore.getState().repos[REPO_ID]?.operations.fetch).toMatchObject({
      phase: 'running',
      reason: 'pull',
      target: null,
    })

    release()
    await expect(work).resolves.toBe('ok')

    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('idle')
    expect(repoOperation(REPO_ID, 'fetch').phase).toBe('idle')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBeNull()
    expect(useReposStore.getState().repos[REPO_ID]?.operations.branchAction).toMatchObject({
      phase: 'idle',
      target: null,
    })
    expect(useReposStore.getState().repos[REPO_ID]?.operations.fetch).toMatchObject({
      phase: 'idle',
      target: null,
    })
  })

  test('returns busyResult without scheduling when blocked', async () => {
    let release!: () => void
    const first = runExclusiveOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'network',
      priority: 1,
      targets: [{ key: 'fetch', reason: 'user-fetch' }],
      busyResult: { ok: false, message: 'busy' },
      task: () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, message: 'done' })
        }),
    })
    let secondRan = false
    const second = await runExclusiveOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'network',
      priority: 1,
      targets: [{ key: 'fetch', reason: 'user-fetch' }],
      busyResult: { ok: false, message: 'busy' },
      task: async () => {
        secondRan = true
        return { ok: true, message: 'should-not-run' }
      },
    })

    expect(second).toEqual({ ok: false, message: 'busy' })
    expect(secondRan).toBe(false)
    release()
    await expect(first).resolves.toEqual({ ok: true, message: 'done' })
  })

  test('records operation view errors when current work fails', async () => {
    const result = await runExclusiveOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'network',
      priority: 1,
      targets: [{ key: 'fetch', reason: 'fetch' }],
      errorResult: (message) => ({ ok: false, message }),
      task: async () => {
        throw new Error('fetch failed')
      },
    })

    expect(result).toEqual({ ok: false, message: 'fetch failed' })
    expect(useReposStore.getState().repos[REPO_ID]?.operations.fetch).toMatchObject({
      phase: 'idle',
      reason: 'fetch',
      target: null,
      error: 'fetch failed',
    })
  })

  test('treats any busy target as blocked before scheduling', async () => {
    let release!: () => void
    const first = runExclusiveOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'network',
      priority: 1,
      targets: [{ key: 'fetch', reason: 'fetch' }],
      task: () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, message: 'done' })
        }),
    })
    let ran = false

    const result = await runExclusiveOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'network',
      priority: 1,
      targets: [
        { key: 'branchAction', reason: 'branch:pull' },
        { key: 'fetch', reason: 'pull' },
      ],
      busyResult: { ok: false, message: 'busy' },
      task: async () => {
        ran = true
        return { ok: true, message: 'should-not-run' }
      },
    })

    expect(result).toEqual({ ok: false, message: 'busy' })
    expect(ran).toBe(false)
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('idle')
    release()
    await expect(first).resolves.toEqual({ ok: true, message: 'done' })
  })
})

describe('runLatestOperation active-task cancellation', () => {
  test('a same-key submission aborts the in-flight active task', async () => {
    // The first run's task body awaits a never-resolving promise.
    // Its signal must be aborted by the lane when the second run
    // comes in (latest-wins), so the task can reject instead of
    // holding the concurrency slot until its own timeout.
    let activeAborted = false
    let release!: () => void
    const activeSettled = new Promise<void>((resolve) => {
      release = () => resolve()
    })
    const first = runLatestOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'lifecycle',
      operationKey: 'remoteLifecycle',
      priority: 1,
      targets: [{ key: 'remoteLifecycle', reason: 'manual-refresh' }],
      task: (signal) =>
        new Promise<{ ok: true; tag: 'first' }>((resolve) => {
          signal.addEventListener('abort', () => {
            activeAborted = true
            resolve({ ok: true, tag: 'first' })
            release()
          })
        }),
    })
    // Yield once so the first run's `markOperationState` +
    // `start` actually land the controller in the active index.
    await Promise.resolve()

    let secondStarted = false
    const second = runLatestOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'lifecycle',
      operationKey: 'remoteLifecycle',
      priority: 1,
      targets: [{ key: 'remoteLifecycle', reason: 'manual-refresh' }],
      task: async () => {
        secondStarted = true
        return { ok: true, tag: 'second' as const }
      },
    })

    // The first run's task body has synchronously seen the
    // abort. The second run's task body is queued to start in
    // the next microtask (after the active-cancel's `.finally`
    // decrements `active` and `drain()` shifts the new task
    // over). Yield a few times so the microtask queue drains.
    expect(activeAborted).toBe(true)
    for (let i = 0; i < 5; i += 1) await Promise.resolve()
    expect(secondStarted).toBe(true)

    await first
    await second
    await activeSettled
  })

  test('a same-key submission frees the concurrency slot immediately for the next run', async () => {
    // Sanity check: with concurrency=1, if the active-cancel
    // path is broken, the second run sits in the queue for as
    // long as the first run takes. We assert that the second run
    // starts BEFORE the first's task body would otherwise
    // resolve. The first task reacts to the abort by resolving
    // its own promise immediately, simulating a real SSH call
    // that detects `signal.aborted` and bails.
    const first = runLatestOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'lifecycle',
      operationKey: 'remoteLifecycle',
      priority: 1,
      targets: [{ key: 'remoteLifecycle', reason: 'manual-refresh' }],
      task: (signal) =>
        new Promise<{ ok: true }>((resolve) => {
          signal.addEventListener('abort', () => resolve({ ok: true }))
        }),
    })
    await Promise.resolve()

    let secondStarted = false
    const second = runLatestOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'lifecycle',
      operationKey: 'remoteLifecycle',
      priority: 1,
      targets: [{ key: 'remoteLifecycle', reason: 'manual-refresh' }],
      task: async () => {
        secondStarted = true
        return { ok: true }
      },
    })
    // Yield a few times so the abort propagates, the old
    // task body resolves, the queue drains, and the new task
    // starts. With the active-cancel path, this is a few
    // microtasks; without it, the second run would never
    // start (the first's promise would never settle on its
    // own).
    for (let i = 0; i < 5; i += 1) await Promise.resolve()
    expect(secondStarted).toBe(true)

    await first
    await second
  })

  test('active-cancel does not affect tasks with a different replaceKey', async () => {
    // The `read` lane's default-key tasks (no `operationKey`)
    // must not be aborted by a `lifecycle` submission. The lane
    // index is keyed by `replaceKey`, so unrelated tasks are
    // insulated.
    const reads: string[] = []
    let releaseRead!: () => void
    const read = runLatestOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'read',
      priority: 1,
      targets: [{ key: 'repoReadModel', reason: 'repo-read-model' }],
      task: () =>
        new Promise<{ ok: true }>((resolve) => {
          reads.push('started')
          releaseRead = () => resolve({ ok: true })
        }),
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(reads).toEqual(['started'])

    // Submit a same-lane read with a different `operationKey`
    // (so a different `replaceKey`). It supersedes ONLY by
    // queuing, not by aborting — the read concurrency is 3, so
    // both can run in parallel; and the replaceKeys differ.
    const read2 = runLatestOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'read',
      operationKey: 'visible-status',
      priority: 1,
      targets: [{ key: 'visibleStatus', reason: 'visible-status' }],
      task: async () => ({ ok: true }),
    })
    // `read` is still running. The cancelActiveByKey for
    // `read:visible-status` finds no active match (the active one is
    // keyed `undefined`). So the original read is NOT aborted.
    await new Promise((r) => setTimeout(r, 0))
    expect(reads).toEqual(['started'])

    releaseRead()
    await read
    await read2
  })

  test('stale run does not overwrite the new run on the lifecycle union', async () => {
    // End-to-end check that supersede preserves the new run's
    // result, even when the old run's task body resolved with
    // a sentinel value via the abort listener. The
    // `runLatestOperation` returns `null` for a stale run
    // (because the new run superseded it) — the OLD's result
    // does NOT leak to the caller. The NEW run returns its
    // own result normally.
    const old = runLatestOperation<string>({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'lifecycle',
      operationKey: 'remoteLifecycle',
      priority: 1,
      targets: [{ key: 'remoteLifecycle', reason: 'manual-refresh' }],
      task: (signal) =>
        new Promise<string>((resolve) => {
          signal.addEventListener('abort', () => {
            // Sentinel value. If the orchestrator's
            // stale-suppression is broken, this would be
            // returned to the caller.
            resolve('OLD')
          })
        }),
    })
    await Promise.resolve()

    const fresh = runLatestOperation<string>({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'lifecycle',
      operationKey: 'remoteLifecycle',
      priority: 1,
      targets: [{ key: 'remoteLifecycle', reason: 'manual-refresh' }],
      task: async () => 'NEW',
    })

    // OLD: null because the new run superseded it (ctx.isCurrent
    // is false → return null).
    // NEW: the actual task result, because this run is current.
    expect(await old).toBeNull()
    expect(await fresh).toBe('NEW')
  })

  test('query cancellation is stale even when the primary target is still current', async () => {
    let rejectReadModel!: (reason: unknown) => void
    const onError = vi.fn()
    const onStale = vi.fn()
    const readModel = runLatestOperation<string>({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'read',
      operationKey: 'repo-read-model',
      priority: 50,
      targets: [
        { key: 'repoReadModel', reason: 'repo-read-model' },
        { key: 'visibleStatus', reason: 'visible-status' },
      ],
      task: () =>
        new Promise<string>((_resolve, reject) => {
          rejectReadModel = reject
        }),
      onError,
      onStale,
    })
    await Promise.resolve()

    await runLatestOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'read',
      operationKey: 'visible-status',
      priority: 40,
      targets: [{ key: 'visibleStatus', reason: 'visible-status' }],
      task: async () => 'visible-status',
    })
    rejectReadModel(new CancelledError())

    await expect(readModel).resolves.toBeNull()
    expect(onError).not.toHaveBeenCalled()
    expect(onStale).toHaveBeenCalledTimes(1)
    expect(useReposStore.getState().repos[REPO_ID]?.operations.repoReadModel).toMatchObject({
      phase: 'idle',
      error: null,
    })
  })

  test('an AbortError caused by the scheduler signal is stale', async () => {
    const onError = vi.fn()
    const onStale = vi.fn()
    const abortError = () => {
      const err = new Error('The operation was aborted.')
      err.name = 'AbortError'
      return err
    }
    const first = runLatestOperation<string>({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'lifecycle',
      operationKey: 'remoteLifecycle',
      priority: 1,
      targets: [{ key: 'remoteLifecycle', reason: 'manual-refresh' }],
      task: (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(abortError()), { once: true })
        }),
      onError,
      onStale,
    })
    await Promise.resolve()

    const second = runLatestOperation<string>({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-test',
      lane: 'lifecycle',
      operationKey: 'remoteLifecycle',
      priority: 1,
      targets: [{ key: 'remoteLifecycle', reason: 'manual-refresh' }],
      task: async () => 'fresh',
    })

    await expect(first).resolves.toBeNull()
    await expect(second).resolves.toBe('fresh')
    expect(onError).not.toHaveBeenCalled()
    expect(onStale).toHaveBeenCalledTimes(1)
  })
})
