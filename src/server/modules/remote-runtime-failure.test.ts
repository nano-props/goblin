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
    expect(
      remoteRuntimeFailureReasonFromCommandResult({
        ok: false,
        stdout: '',
        stderr: 'Received disconnect from 192.0.2.1 port 22:2: Too many authentication failures',
      }),
    ).toBe('auth-failed')
    expect(
      remoteRuntimeFailureReasonFromCommandResult({
        ok: false,
        stdout: '',
        stderr: 'kex_exchange_identification: Connection closed by UNKNOWN port 65535',
      }),
    ).toBe('handshake-failed')
  })

  test('does not classify remote command failures after the remote shell starts', () => {
    expect(
      remoteRuntimeFailureReasonFromCommandResult({
        ok: false,
        stdout: '',
        stderr: 'git@github.com: Permission denied (publickey).',
        message: 'git@github.com: Permission denied (publickey).',
        remoteStarted: true,
      }),
    ).toBeNull()
    expect(
      remoteRuntimeFailureReasonFromCommandResult({
        ok: false,
        stdout: '',
        stderr: 'Host key verification failed.',
        message: 'Host key verification failed.',
        remoteStarted: true,
      }),
    ).toBeNull()
  })

  test('classifies current SSH session transport loss after the remote shell starts', () => {
    expect(
      remoteRuntimeFailureReasonFromCommandResult({
        ok: false,
        stdout: '',
        stderr: 'Connection to example.com closed by remote host.',
        message: 'Connection to example.com closed by remote host.',
        remoteStarted: true,
      }),
    ).toBe('unreachable')
    expect(
      remoteRuntimeFailureReasonFromCommandResult({
        ok: false,
        stdout: '',
        stderr: 'client_loop: send disconnect: Broken pipe',
        message: 'client_loop: send disconnect: Broken pipe',
        remoteStarted: true,
      }),
    ).toBe('unreachable')
    expect(
      remoteRuntimeFailureReasonFromCommandResult({
        ok: false,
        stdout: '',
        stderr: '',
        message: 'timeout',
        timedOut: true,
        remoteStarted: true,
      }),
    ).toBe('timeout')
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
