import { beforeEach, describe, expect, test, vi } from 'vitest'
import { abortServerNetworkOp, runServerCancellable } from '#/server/common/network-ops.ts'
import {
  listRepoServerOperations,
  resetRepoServerOperationRegistryForTests,
} from '#/server/modules/repo-operation-registry.ts'

beforeEach(() => {
  resetRepoServerOperationRegistryForTests()
})

describe('server network operation registry projection', () => {
  test('exposes active and settled network operations', async () => {
    let resolveFetch!: (value: { ok: true; message: string }) => void
    const work = runServerCancellable(
      '/tmp/repo',
      'background',
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
      { operationKind: 'fetch' },
    )

    await vi.waitFor(() => {
      expect(listRepoServerOperations({ repoId: '/tmp/repo' })[0]).toMatchObject({
        repoId: '/tmp/repo',
        kind: 'fetch',
        phase: 'running',
        source: 'background',
      })
    })

    resolveFetch({ ok: true, message: 'ok' })
    await expect(work).resolves.toEqual({ ok: true, message: 'ok' })
    expect(listRepoServerOperations({ repoId: '/tmp/repo' })).toEqual([])
    expect(listRepoServerOperations({ repoId: '/tmp/repo', includeSettled: true })[0]).toMatchObject({
      kind: 'fetch',
      phase: 'done',
      error: null,
    })
  })

  test('records user cancellation as structured operation state', async () => {
    const work = runServerCancellable(
      '/tmp/repo',
      'user',
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ ok: false, message: 'cancelled' }))
        }),
      { operationKind: 'fetch' },
    )

    await vi.waitFor(() => {
      expect(listRepoServerOperations({ repoId: '/tmp/repo' })[0]?.phase).toBe('running')
    })
    expect(abortServerNetworkOp('/tmp/repo')).toBe(true)

    await expect(work).resolves.toEqual({ ok: false, message: 'cancelled' })
    expect(listRepoServerOperations({ repoId: '/tmp/repo', includeSettled: true })[0]).toMatchObject({
      kind: 'fetch',
      phase: 'failed',
      cancellation: {
        underlyingRequested: true,
        reason: 'user-cancel',
      },
      error: {
        message: 'cancelled',
        reason: 'user-cancel',
      },
    })
  })
})
