import { describe, expect, test } from 'vitest'
import { refreshFailureMessage } from '#/web/stores/workspaces/refresh-sync.ts'

describe('refreshFailureMessage', () => {
  test('keeps a bare cancellation silent', () => {
    expect(refreshFailureMessage({ ok: false, message: 'cancelled' })).toBeNull()
  })

  test('surfaces recovery guidance attached to a cancellation', () => {
    expect(
      refreshFailureMessage({
        ok: false,
        message: 'cancelled',
        recoveryMessageKeys: ['error.workspace-runtime-settlement-failed'],
      }),
    ).toBe('error.workspace-runtime-settlement-failed')
  })

  test('surfaces an ordinary failure', () => {
    expect(refreshFailureMessage({ ok: false, message: 'error.failed-read-repo' })).toBe('error.failed-read-repo')
  })
})
