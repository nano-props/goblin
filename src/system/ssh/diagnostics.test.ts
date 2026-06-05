import { describe, expect, test } from 'vitest'
import { classifySshFailure } from '#/system/ssh/diagnostics.ts'

describe('classifySshFailure', () => {
  test('classifies connection reset during ssh handshake as handshake failure', () => {
    expect(
      classifySshFailure({
        ok: false,
        stdout: '',
        stderr:
          'kex_exchange_identification: read: Connection reset by peer\nConnection reset by 100.64.1.18 port 2222',
        message: 'Command failed with exit code 255',
        timedOut: false,
      }),
    ).toBe('handshake-failed')
  })

  test('keeps shell-failed for generic post-connect ssh errors', () => {
    expect(
      classifySshFailure({
        ok: false,
        stdout: '',
        stderr: 'remote command failed unexpectedly',
        message: 'Command failed with exit code 255',
        timedOut: false,
      }),
    ).toBe('shell-failed')
  })
})
