import { describe, expect, test } from 'vitest'
import { remoteRuntimeFailureReasonFromCommandResult } from '#/server/modules/remote-runtime-failure.ts'

describe('remote runtime failure classification', () => {
  test('classifies SSH transport failures', () => {
    expect(
      remoteRuntimeFailureReasonFromCommandResult({
        ok: false,
        stdout: '',
        stderr: '',
        message: 'timeout',
        timedOut: true,
      }),
    ).toBe('timeout')
    expect(
      remoteRuntimeFailureReasonFromCommandResult({
        ok: false,
        stdout: '',
        stderr: 'ssh: connect to host example.test port 22: Operation timed out',
      }),
    ).toBe('unreachable')
    expect(
      remoteRuntimeFailureReasonFromCommandResult({
        ok: false,
        stdout: '',
        stderr: 'kex_exchange_identification: read: Connection reset by peer',
      }),
    ).toBe('handshake-failed')
    expect(
      remoteRuntimeFailureReasonFromCommandResult({
        ok: false,
        stdout: '',
        stderr: 'Host key verification failed.',
      }),
    ).toBe('host-key')
  })

  test('does not classify ordinary command failures or stale runtime as reachability failures', () => {
    expect(
      remoteRuntimeFailureReasonFromCommandResult({
        ok: false,
        stdout: '',
        stderr: 'fatal: not a git repository',
      }),
    ).toBeNull()
    expect(
      remoteRuntimeFailureReasonFromCommandResult({
        ok: false,
        stdout: '',
        stderr: '',
        message: 'error.repo-runtime-stale',
      }),
    ).toBeNull()
  })
})
