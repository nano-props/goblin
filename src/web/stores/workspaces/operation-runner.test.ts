import { seedRepoShellForTest, resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { CancelledError } from '@tanstack/query-core'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { runExclusiveOperation, runLatestOperation } from '#/web/stores/workspaces/operation-runner.ts'
import { repoOperation, repoOperationBusy } from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { requireGitWorkspaceForTest } from '#/web/stores/workspaces/git-workspace-client-state.test-utils.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
const REPO_ID = workspaceIdForTest('goblin+file:///workspace/operation-runner')

beforeEach(() => {
  resetWorkspacesStore()
  seedRepoShellForTest({
    id: REPO_ID,
    workspaceRuntimeId: 'repo-runtime-test',
    workspaceProbe: {
      status: 'ready',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
      },
      diagnostics: [],
    },
  })
})

describe('runLatestOperation', () => {
  test('replaces older queued operations before they start', async () => {
    const starts: string[] = []
    let releaseActive!: () => void
    const active = runLatestOperation({
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      lane: 'network',
      operationKey: 'branch-action-test',
      priority: 1,
      targets: [{ key: 'branchAction', reason: 'branch:pull' }],
      task: () =>
        new Promise<string>((resolve) => {
          starts.push('active')
          releaseActive = () => resolve('active')
        }),
    })
    const replaced = runLatestOperation({
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      lane: 'network',
      operationKey: 'branch-action-test',
      priority: 1,
      targets: [{ key: 'branchAction', reason: 'branch:pull' }],
      task: async () => {
        starts.push('replaced')
        return 'replaced'
      },
    })
    const latest = runLatestOperation({
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      lane: 'network',
      operationKey: 'branch-action-test',
      priority: 1,
      targets: [{ key: 'branchAction', reason: 'branch:pull' }],
      task: async () => {
        starts.push('latest')
        return 'latest'
      },
    })

    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('queued')
    expect(
      requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction
        .phase,
    ).toBe('queued')
    releaseActive()

    await expect(active).resolves.toBeNull()
    await expect(replaced).resolves.toBeNull()
    await expect(latest).resolves.toBe('latest')
    expect(starts).toEqual(['active', 'latest'])
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('idle')
    expect(
      requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction
        .phase,
    ).toBe('idle')
  })
})

describe('runExclusiveOperation', () => {
  test('marks and settles all targets together', async () => {
    let release!: () => void
    const work = runExclusiveOperation({
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
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
    expect(
      requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction,
    ).toMatchObject({
      phase: 'running',
      reason: 'branch:pull',
      target: 'feature/a',
    })

    release()
    await expect(work).resolves.toBe('ok')

    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('idle')
    expect(repoOperation(REPO_ID, 'fetch').phase).toBe('idle')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBeNull()
    expect(
      requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction,
    ).toMatchObject({
      phase: 'idle',
      target: null,
    })
  })

  test('returns busyResult without scheduling when blocked', async () => {
    let release!: () => void
    const first = runExclusiveOperation({
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
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
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
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

  test('maps task failures to error results and settles operation state', async () => {
    const result = await runExclusiveOperation({
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      lane: 'network',
      priority: 1,
      targets: [{ key: 'fetch', reason: 'fetch' }],
      errorResult: (message) => ({ ok: false, message }),
      task: async () => {
        throw new Error('fetch failed')
      },
    })

    expect(result).toEqual({ ok: false, message: 'fetch failed' })
    expect(repoOperation(REPO_ID, 'fetch')).toMatchObject({ phase: 'idle', reason: null, target: null })
  })

  test('treats any busy target as blocked before scheduling', async () => {
    let release!: () => void
    const first = runExclusiveOperation({
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
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
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
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
    let activeAborted = false
    const first = runLatestOperation({
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      lane: 'write',
      operationKey: 'remoteLifecycle',
      priority: 1,
      targets: [{ key: 'remoteLifecycle', reason: 'workspace-refresh' }],
      task: (signal) =>
        new Promise<{ ok: true; tag: 'first' }>((resolve) => {
          signal.addEventListener('abort', () => {
            activeAborted = true
            resolve({ ok: true, tag: 'first' })
          })
        }),
    })
    await Promise.resolve()

    let secondStarted = false
    const second = runLatestOperation({
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      lane: 'write',
      operationKey: 'remoteLifecycle',
      priority: 1,
      targets: [{ key: 'remoteLifecycle', reason: 'workspace-refresh' }],
      task: async () => {
        secondStarted = true
        return { ok: true, tag: 'second' as const }
      },
    })

    expect(activeAborted).toBe(true)
    await vi.waitFor(() => expect(secondStarted).toBe(true))

    await first
    await second
  })

  test('does not abort an active task with a different replaceKey', async () => {
    const reads: string[] = []
    let readAborted = false
    let releaseRead!: () => void
    const read = runLatestOperation({
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      lane: 'read',
      priority: 1,
      targets: [{ key: 'branchAction', reason: 'branch:pull' }],
      task: (signal) =>
        new Promise<{ ok: true }>((resolve) => {
          reads.push('started')
          signal.addEventListener('abort', () => {
            readAborted = true
            resolve({ ok: true })
          })
          releaseRead = () => resolve({ ok: true })
        }),
    })
    await vi.waitFor(() => expect(reads).toEqual(['started']))

    const read2 = runLatestOperation({
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      lane: 'read',
      operationKey: 'branch-action-test',
      priority: 1,
      targets: [{ key: 'branchAction', reason: 'branch:pull' }],
      task: async () => ({ ok: true }),
    })
    await read2
    expect(readAborted).toBe(false)

    releaseRead()
    await read
  })

  test('stale run does not overwrite the new run on the latest-wins target', async () => {
    // End-to-end check that supersede preserves the new run's
    // result, even when the old run's task body resolved with
    // a sentinel value via the abort listener. The
    // `runLatestOperation` returns `null` for a stale run
    // (because the new run superseded it) — the OLD's result
    // does NOT leak to the caller. The NEW run returns its
    // own result normally.
    const old = runLatestOperation<string>({
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      lane: 'write',
      operationKey: 'remoteLifecycle',
      priority: 1,
      targets: [{ key: 'remoteLifecycle', reason: 'workspace-refresh' }],
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
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      lane: 'write',
      operationKey: 'remoteLifecycle',
      priority: 1,
      targets: [{ key: 'remoteLifecycle', reason: 'workspace-refresh' }],
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
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      lane: 'read',
      operationKey: 'branch-action-test',
      priority: 50,
      targets: [
        { key: 'branchAction', reason: 'branch:pull' },
        { key: 'workspaceRefresh', reason: 'workspace-refresh' },
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
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      lane: 'read',
      operationKey: 'workspace-refresh',
      priority: 40,
      targets: [{ key: 'workspaceRefresh', reason: 'workspace-refresh' }],
      task: async () => 'workspace-refresh',
    })
    rejectReadModel(new CancelledError())

    await expect(readModel).resolves.toBeNull()
    expect(onError).not.toHaveBeenCalled()
    expect(onStale).toHaveBeenCalledTimes(1)
    expect(
      requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction,
    ).toMatchObject({
      phase: 'idle',
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
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      lane: 'write',
      operationKey: 'remoteLifecycle',
      priority: 1,
      targets: [{ key: 'remoteLifecycle', reason: 'workspace-refresh' }],
      task: (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(abortError()), { once: true })
        }),
      onError,
      onStale,
    })
    await Promise.resolve()

    const second = runLatestOperation<string>({
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      lane: 'write',
      operationKey: 'remoteLifecycle',
      priority: 1,
      targets: [{ key: 'remoteLifecycle', reason: 'workspace-refresh' }],
      task: async () => 'fresh',
    })

    await expect(first).resolves.toBeNull()
    await expect(second).resolves.toBe('fresh')
    expect(onError).not.toHaveBeenCalled()
    expect(onStale).toHaveBeenCalledTimes(1)
  })
})
