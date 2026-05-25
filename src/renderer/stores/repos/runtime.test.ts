import { beforeEach, describe, expect, test } from 'vitest'
import {
  disposeAllRepoRuntimes,
  disposeRepoRuntime,
  markRepoOperationTargets,
  pruneRepoBranchPullRequestOperations,
  repoOperation,
  repoOperationBusy,
  scheduleRepoTask,
  settleRepoOperationTargets,
} from '#/renderer/stores/repos/runtime.ts'

const REPO_ID = '/tmp/gbl-runtime-test-repo'

beforeEach(() => {
  disposeAllRepoRuntimes()
})

describe('repo runtime task scheduling', () => {
  test('runs queued tasks by priority within a lane', async () => {
    const starts: string[] = []
    let releaseFirst!: () => void
    const first = scheduleRepoTask(
      REPO_ID,
      'network',
      () =>
        new Promise<string>((resolve) => {
          starts.push('first')
          releaseFirst = () => resolve('first')
        }),
    )
    const low = scheduleRepoTask(
      REPO_ID,
      'network',
      async () => {
        starts.push('low')
        return 'low'
      },
      { priority: 1 },
    )
    const high = scheduleRepoTask(
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
    const first = scheduleRepoTask(
      REPO_ID,
      'network',
      () =>
        new Promise<string>((resolve) => {
          starts.push('first')
          releaseFirst = () => resolve('first')
        }),
    )
    const replaced = scheduleRepoTask(REPO_ID, 'network', async () => 'replaced', { replaceQueuedKey: 'status' })
    const latest = scheduleRepoTask(
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

  test('dispose aborts active tasks and rejects queued tasks', async () => {
    let activeAborted = false
    const active = scheduleRepoTask(
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
    const queued = scheduleRepoTask(REPO_ID, 'network', async () => 'queued')

    disposeRepoRuntime(REPO_ID)

    await expect(active).rejects.toThrow('active cancelled')
    await expect(queued).rejects.toThrow('cancelled')
    expect(activeAborted).toBe(true)
  })

  test('dispose clears operation busy state without recreating runtime on read or settle', () => {
    markRepoOperationTargets(REPO_ID, 1, [{ key: 'fetch', reason: 'fetch' }], 'running')

    expect(repoOperationBusy(REPO_ID, 'fetch')).toBe(true)

    disposeRepoRuntime(REPO_ID)
    settleRepoOperationTargets(REPO_ID, 1, [{ key: 'fetch', reason: 'fetch' }], null)

    expect(repoOperationBusy(REPO_ID, 'fetch')).toBe(false)
    expect(repoOperation(REPO_ID, 'fetch').phase).toBe('idle')
  })

  test('prunes pull request operation state for removed branches', () => {
    markRepoOperationTargets(
      REPO_ID,
      1,
      [
        { key: 'pullRequests', reason: 'summary' },
        { key: 'pullRequest:feature/a', reason: 'summary' },
        { key: 'pullRequest:feature/stale', reason: 'summary' },
        { key: 'log:feature/stale', reason: 'log' },
      ],
      'running',
    )
    settleRepoOperationTargets(
      REPO_ID,
      1,
      [
        { key: 'pullRequests', reason: 'summary' },
        { key: 'pullRequest:feature/a', reason: 'summary' },
        { key: 'pullRequest:feature/stale', reason: 'summary' },
        { key: 'log:feature/stale', reason: 'log' },
      ],
      null,
    )

    pruneRepoBranchPullRequestOperations(REPO_ID, new Set(['feature/a']))

    expect(repoOperation(REPO_ID, 'pullRequests').operationId).toBe(1)
    expect(repoOperation(REPO_ID, 'pullRequest:feature/a').operationId).toBe(1)
    expect(repoOperation(REPO_ID, 'pullRequest:feature/stale').operationId).toBe(0)
    expect(repoOperation(REPO_ID, 'log:feature/stale').operationId).toBe(1)
  })
})
