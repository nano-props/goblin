import { beforeEach, describe, expect, test, vi } from 'vitest'
import { OperationCancelledError } from '#/shared/operation-cancelled.ts'

const mocks = vi.hoisted(() => ({ execa: vi.fn() }))

vi.mock('execa', () => ({
  execa: mocks.execa,
  ExecaError: class ExecaError extends Error {},
}))

describe('git cancellation decoding', () => {
  beforeEach(() => {
    mocks.execa.mockReset()
  })

  test('normalizes a cancellation object from a different JavaScript realm', async () => {
    mocks.execa.mockRejectedValueOnce({ isCanceled: true, shortMessage: 'cancelled by transport' })
    const { git } = await import('#/system/git/git-exec.ts')

    await expect(git('/tmp/repository', ['status'])).rejects.toBeInstanceOf(OperationCancelledError)
  })

  test('uses the exact process cancel signal as authority when the rejection loses cancellation metadata', async () => {
    const controller = new AbortController()
    mocks.execa.mockImplementationOnce(
      (_command: string, _args: string[], options: { cancelSignal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.cancelSignal?.addEventListener('abort', () => reject(new Error('transport closed')), { once: true })
        }),
    )
    const { git } = await import('#/system/git/git-exec.ts')
    const result = git('/tmp/repository', ['status'], { signal: controller.signal })
    controller.abort()

    await expect(result).rejects.toBeInstanceOf(OperationCancelledError)
  })

  test('does not classify an ordinary process failure as cancellation', async () => {
    const failure = { isCanceled: false, shortMessage: 'git failed' }
    mocks.execa.mockRejectedValueOnce(failure)
    const { git } = await import('#/system/git/git-exec.ts')

    await expect(git('/tmp/repository', ['status'])).rejects.toBe(failure)
  })

  test('reports an aborted command as not started when cancellation predates invocation', async () => {
    const controller = new AbortController()
    controller.abort()
    const { gitCommandResultWithOptions } = await import('#/system/git/git-exec.ts')

    const outcome = await gitCommandResultWithOptions('/tmp/repository', { signal: controller.signal }, 'status')

    expect(outcome).toEqual({
      result: { ok: false, message: 'cancelled' },
      execution: { status: 'not-started' },
    })
    expect(mocks.execa).not.toHaveBeenCalled()
  })

  test('reports cancellation observed after process start as cancelled execution', async () => {
    const controller = new AbortController()
    mocks.execa.mockImplementationOnce(
      (_command: string, _args: string[], options: { cancelSignal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.cancelSignal?.addEventListener('abort', () => reject(new Error('transport closed')), { once: true })
        }),
    )
    const { gitCommandResultWithOptions } = await import('#/system/git/git-exec.ts')
    const pending = gitCommandResultWithOptions('/tmp/repository', { signal: controller.signal }, 'status')
    controller.abort()

    await expect(pending).resolves.toEqual({
      result: { ok: false, message: 'cancelled' },
      execution: { status: 'cancelled' },
    })
  })

  test('reports an ordinary post-start rejection as failed execution', async () => {
    mocks.execa.mockRejectedValueOnce(new Error('git failed'))
    const { gitCommandResultWithOptions } = await import('#/system/git/git-exec.ts')

    const outcome = await gitCommandResultWithOptions('/tmp/repository', undefined, 'status')

    expect(outcome).toEqual({
      result: { ok: false, message: 'git failed' },
      execution: { status: 'failed' },
    })
  })

  test('reports a provable process start failure as not started', async () => {
    const { ExecaError } = await import('execa')
    const failure = Object.assign(new ExecaError(), {
      message: 'git executable was not found',
      code: 'ENOENT',
      exitCode: undefined,
      signal: undefined,
    })
    mocks.execa.mockRejectedValueOnce(failure)
    const { gitCommandResultWithOptions } = await import('#/system/git/git-exec.ts')

    const outcome = await gitCommandResultWithOptions('/tmp/repository', undefined, 'status')

    expect(outcome).toEqual({
      result: { ok: false, message: 'git executable was not found' },
      execution: { status: 'not-started' },
    })
  })
})
