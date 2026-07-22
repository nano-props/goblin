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
})
