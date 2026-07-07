import { beforeEach, describe, expect, test } from 'vitest'
import {
  disposeAllRepoOperationSchedulers,
  disposeRepoOperationScheduler,
  markRepoOperationTargets,
  repoOperation,
  repoOperationBusy,
  scheduleRepoOperation,
  settleRepoOperationTargets,
} from '#/web/stores/repos/repo-operation-scheduler.ts'
const REPO_ID = '/tmp/gbl-runtime-test-repo'

beforeEach(() => {
  disposeAllRepoOperationSchedulers()
})

describe('repo runtime task scheduling', () => {
  test('runs queued tasks by priority within a lane', async () => {
    const starts: string[] = []
    let releaseFirst!: () => void
    const first = scheduleRepoOperation(
      REPO_ID,
      'network',
      () =>
        new Promise<string>((resolve) => {
          starts.push('first')
          releaseFirst = () => resolve('first')
        }),
    )
    const low = scheduleRepoOperation(
      REPO_ID,
      'network',
      async () => {
        starts.push('low')
        return 'low'
      },
      { priority: 1 },
    )
    const high = scheduleRepoOperation(
      REPO_ID,
      'network',
      async () => {
        starts.push('high')
        return 'high'
      },
      { priority: 10 },
    )

    expect(starts).toEqual(['first'])
    releaseFirst()

    await expect(Promise.all([first, high, low])).resolves.toEqual(['first', 'high', 'low'])
    expect(starts).toEqual(['first', 'high', 'low'])
  })

  test('replaces older queued tasks with the same key', async () => {
    const starts: string[] = []
    let releaseFirst!: () => void
    const first = scheduleRepoOperation(
      REPO_ID,
      'network',
      () =>
        new Promise<string>((resolve) => {
          starts.push('first')
          releaseFirst = () => resolve('first')
        }),
    )
    const replaced = scheduleRepoOperation(REPO_ID, 'network', async () => 'replaced', { replaceQueuedKey: 'status' })
    const latest = scheduleRepoOperation(
      REPO_ID,
      'network',
      async () => {
        starts.push('latest')
        return 'latest'
      },
      { replaceQueuedKey: 'status' },
    )

    await expect(replaced).rejects.toThrow('cancelled')
    releaseFirst()

    await expect(Promise.all([first, latest])).resolves.toEqual(['first', 'latest'])
    expect(starts).toEqual(['first', 'latest'])
  })

  test('rejects queued tasks after their queue timeout', async () => {
    let releaseFirst!: () => void
    const first = scheduleRepoOperation(
      REPO_ID,
      'network',
      () =>
        new Promise<string>((resolve) => {
          releaseFirst = () => resolve('first')
        }),
    )
    const queued = scheduleRepoOperation(REPO_ID, 'network', async () => 'queued', {
      queuedTimeoutMs: 1,
      queuedTimeoutMessage: 'queued timeout',
    })

    await expect(queued).rejects.toThrow('queued timeout')

    releaseFirst()
    await expect(first).resolves.toBe('first')
  })

  test('dispose aborts active tasks and rejects queued tasks', async () => {
    let activeAborted = false
    const active = scheduleRepoOperation(
      REPO_ID,
      'network',
      (signal) =>
        new Promise<string>((_, reject) => {
          signal.addEventListener('abort', () => {
            activeAborted = true
            reject(new Error('active cancelled'))
          })
        }),
    )
    const queued = scheduleRepoOperation(REPO_ID, 'network', async () => 'queued')
    const queuedRejected = expect(queued).rejects.toThrow('cancelled')

    disposeRepoOperationScheduler(REPO_ID)

    await expect(active).rejects.toThrow('active cancelled')
    await queuedRejected
    expect(activeAborted).toBe(true)
  })

  test('dispose clears operation busy state without recreating runtime on read or settle', () => {
    markRepoOperationTargets(REPO_ID, 1, [{ key: 'fetch', reason: 'fetch' }], 'running')

    expect(repoOperationBusy(REPO_ID, 'fetch')).toBe(true)

    disposeRepoOperationScheduler(REPO_ID)
    settleRepoOperationTargets(REPO_ID, 1, [{ key: 'fetch', reason: 'fetch' }], null)

    expect(repoOperationBusy(REPO_ID, 'fetch')).toBe(false)
    expect(repoOperation(REPO_ID, 'fetch').phase).toBe('idle')
  })

})
