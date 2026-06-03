import { beforeEach, describe, expect, test } from 'vitest'
import { runExclusiveOperation, runLatestOperation } from '#/web/stores/repos/operation-runner.ts'
import { repoOperation, repoOperationBusy } from '#/web/stores/repos/runtime.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
const REPO_ID = '/tmp/gbl-operation-runner-test-repo'

beforeEach(() => {
  resetReposStore()
  seedRepoState({ id: REPO_ID, instanceToken: 1 })
})

describe('runLatestOperation', () => {
  test('replaces older queued operations before they start', async () => {
    const starts: string[] = []
    let releaseActive!: () => void
    const active = runLatestOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      token: 1,
      lane: 'network',
      operationKey: 'status',
      priority: 1,
      targets: [{ key: 'status', reason: 'status' }],
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
      token: 1,
      lane: 'network',
      operationKey: 'status',
      priority: 1,
      targets: [{ key: 'status', reason: 'status' }],
      task: async () => {
        starts.push('replaced')
        return 'replaced'
      },
    })
    const latest = runLatestOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      token: 1,
      lane: 'network',
      operationKey: 'status',
      priority: 1,
      targets: [{ key: 'status', reason: 'status' }],
      task: async () => {
        starts.push('latest')
        return 'latest'
      },
    })

    expect(repoOperation(REPO_ID, 'status').phase).toBe('queued')
    expect(useReposStore.getState().repos[REPO_ID]?.operations.status.phase).toBe('queued')
    releaseActive()

    await expect(active).resolves.toBeNull()
    await expect(replaced).resolves.toBeNull()
    await expect(latest).resolves.toBe('latest')
    expect(starts).toEqual(['active', 'latest'])
    expect(repoOperation(REPO_ID, 'status').phase).toBe('idle')
    expect(useReposStore.getState().repos[REPO_ID]?.operations.status.phase).toBe('idle')
  })
})

describe('runExclusiveOperation', () => {
  test('marks and settles all targets together', async () => {
    let release!: () => void
    const work = runExclusiveOperation({
      set: useReposStore.setState,
      get: useReposStore.getState,
      id: REPO_ID,
      token: 1,
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
      token: 1,
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
      token: 1,
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
      token: 1,
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
      token: 1,
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
      token: 1,
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
