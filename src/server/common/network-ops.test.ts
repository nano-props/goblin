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

  test('caller abort stops a queued user operation while preserving the active background operation', async () => {
    let resolveBackground!: (value: { ok: true; message: string }) => void
    const background = runServerCancellable(
      '/tmp/repo',
      'background',
      () =>
        new Promise((resolve) => {
          resolveBackground = resolve
        }),
      { operationKind: 'fetch' },
    )
    await vi.waitFor(() => {
      expect(listRepoServerOperations({ repoId: '/tmp/repo' })[0]).toMatchObject({
        kind: 'fetch',
        phase: 'running',
        source: 'background',
      })
    })

    const caller = new AbortController()
    const userTask = vi.fn(async () => ({ ok: true as const, message: 'user fetch' }))
    const user = runServerCancellable('/tmp/repo', 'user', userTask, {
      operationKind: 'fetch',
      callerSignal: caller.signal,
    })
    await vi.waitFor(() => {
      expect(listRepoServerOperations({ repoId: '/tmp/repo' })).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: 'user', phase: 'queued' }),
        expect.objectContaining({ source: 'background', phase: 'running' }),
      ]))
    })

    caller.abort()

    await expect(user).resolves.toEqual({ ok: false, message: 'cancelled' })
    expect(userTask).not.toHaveBeenCalled()
    expect(listRepoServerOperations({ repoId: '/tmp/repo' })[0]).toMatchObject({
      source: 'background',
      phase: 'running',
    })
    expect(listRepoServerOperations({ repoId: '/tmp/repo', includeSettled: true })).toContainEqual(
      expect.objectContaining({
        source: 'user',
        phase: 'failed',
        cancellation: expect.objectContaining({
          underlyingRequested: false,
          lastWaitCancellationReason: 'caller-abort',
          waitCancelledCount: 1,
        }),
        error: expect.objectContaining({
          reason: 'caller-abort',
        }),
      }),
    )

    resolveBackground({ ok: true, message: 'background fetch' })
    await expect(background).resolves.toEqual({ ok: true, message: 'background fetch' })
  })

  test('uses a shared gate object to block network operations from linked repo ids', async () => {
    let resolveFetch!: (value: { ok: true; message: string }) => void
    const gate = {}
    const first = runServerCancellable(
      '/tmp/repo',
      'user',
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
      { gate, operationKind: 'fetch' },
    )

    await vi.waitFor(() => {
      expect(listRepoServerOperations({ repoId: '/tmp/repo' })[0]?.phase).toBe('running')
    })

    await expect(
      runServerCancellable('/tmp/repo-linked', 'user', async () => ({ ok: true, message: 'linked fetch' }), {
        gate,
        operationKind: 'fetch',
      }),
    ).resolves.toEqual({ ok: false, message: 'error.network-op-in-progress' })

    resolveFetch({ ok: true, message: 'ok' })
    await expect(first).resolves.toEqual({ ok: true, message: 'ok' })
  })
})
