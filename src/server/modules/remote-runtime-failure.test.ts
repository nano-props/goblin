import { describe, expect, test } from 'vitest'
import { remoteRuntimeFailureReasonFromCommandResult } from '#/server/modules/remote-runtime-failure.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

const target: RemoteRepoTarget = {
  id: 'goblin+ssh://example/srv/repo',
  alias: 'example',
  host: 'example.test',
  user: 'deploy',
  port: 22,
  remotePath: '/srv/repo',
  displayName: 'example:repo',
  sshConnection: {
    destination: 'example',
    options: ['hostname=example.test', 'user=deploy', 'port=22'],
  },
}

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
        transportStderr: '',
      }),
    ).toBeNull()
    expect(
      remoteRuntimeFailureReasonFromCommandResult({
        ok: false,
        stdout: '',
        stderr: 'Host key verification failed.',
        message: 'Host key verification failed.',
        remoteStarted: true,
        transportStderr: '',
      }),
    ).toBeNull()
    expect(
      remoteRuntimeFailureReasonFromCommandResult({
        ok: false,
        stdout: '',
        stderr: 'timeout',
        message: 'timeout',
        remoteStarted: true,
        transportStderr: '',
      }),
    ).toBeNull()
    expect(
      remoteRuntimeFailureReasonFromCommandResult({
        ok: false,
        stdout: '',
        stderr: '',
        message: 'timeout',
        timedOut: true,
        remoteStarted: true,
        transportStderr: '',
      }),
    ).toBeNull()
  })

  test('classifies current SSH session transport loss after the remote shell starts', () => {
    expect(
      remoteRuntimeFailureReasonFromCommandResult(
        {
          ok: false,
          stdout: '',
          stderr: '',
          transportStderr: 'Connection to example closed by remote host.',
          message: 'Connection to example closed by remote host.',
          remoteStarted: true,
        },
        target,
      ),
    ).toBe('unreachable')
    expect(
      remoteRuntimeFailureReasonFromCommandResult(
        {
          ok: false,
          stdout: '',
          stderr: '',
          transportStderr: 'client_loop: send disconnect: Broken pipe',
          message: 'client_loop: send disconnect: Broken pipe',
          remoteStarted: true,
        },
        target,
      ),
    ).toBe('unreachable')
    expect(
      remoteRuntimeFailureReasonFromCommandResult(
        {
          ok: false,
          stdout: '',
          stderr: '',
          transportStderr: 'client_loop: send disconnect: Broken pipe\nConnection to example closed.',
          message: 'client_loop: send disconnect: Broken pipe\nConnection to example closed.',
          remoteStarted: true,
        },
        target,
      ),
    ).toBe('unreachable')
    expect(
      remoteRuntimeFailureReasonFromCommandResult(
        {
          ok: false,
          stdout: '',
          stderr: '',
          transportStderr: 'Connection closed by example port 22',
          message: 'Connection closed by example port 22',
          remoteStarted: true,
        },
        target,
      ),
    ).toBe('unreachable')
    expect(
      remoteRuntimeFailureReasonFromCommandResult(
        {
          ok: false,
          stdout: '',
          stderr: '',
          transportStderr: 'Connection reset by example port 22',
          message: 'Connection reset by example port 22',
          remoteStarted: true,
        },
        target,
      ),
    ).toBe('unreachable')
    expect(
      remoteRuntimeFailureReasonFromCommandResult(
        {
          ok: false,
          stdout: '',
          stderr: '',
          transportStderr: 'Connection to example port 22: Broken pipe',
          message: 'Connection to example port 22: Broken pipe',
          remoteStarted: true,
        },
        target,
      ),
    ).toBe('unreachable')
    expect(
      remoteRuntimeFailureReasonFromCommandResult(
        {
          ok: false,
          stdout: '',
          stderr: '',
          transportStderr: 'Connection to example port 22: Connection closed by remote host',
          message: 'Connection to example port 22: Connection closed by remote host',
          remoteStarted: true,
        },
        target,
      ),
    ).toBe('unreachable')
  })

  test('does not classify upstream SSH transport text after the remote shell starts', () => {
    expect(
      remoteRuntimeFailureReasonFromCommandResult(
        {
          ok: false,
          stdout: '',
          stderr: 'Connection to github.com closed by remote host.',
          message: 'Connection to github.com closed by remote host.',
          remoteStarted: true,
          transportStderr: '',
        },
        target,
      ),
    ).toBeNull()
    expect(
      remoteRuntimeFailureReasonFromCommandResult(
        {
          ok: false,
          stdout: '',
          stderr: '',
          transportStderr: 'Connection closed by example port 222',
          message: 'Connection closed by example port 222',
          remoteStarted: true,
        },
        target,
      ),
    ).toBeNull()
    expect(
      remoteRuntimeFailureReasonFromCommandResult(
        {
          ok: false,
          stdout: '',
          stderr: 'client_loop: send disconnect: Broken pipe',
          transportStderr: '',
          message: 'client_loop: send disconnect: Broken pipe',
          remoteStarted: true,
        },
        target,
      ),
    ).toBeNull()
    expect(
      remoteRuntimeFailureReasonFromCommandResult(
        {
          ok: false,
          stdout: '',
          stderr: 'Connection closed by github.com port 22',
          message: 'Connection closed by github.com port 22',
          remoteStarted: true,
          transportStderr: '',
        },
        target,
      ),
    ).toBeNull()
    expect(
      remoteRuntimeFailureReasonFromCommandResult(
        {
          ok: false,
          stdout: '',
          stderr: 'Connection to github.com port 22: Broken pipe',
          message: 'Connection to github.com port 22: Broken pipe',
          remoteStarted: true,
          transportStderr: '',
        },
        target,
      ),
    ).toBeNull()
    expect(
      remoteRuntimeFailureReasonFromCommandResult(
        {
          ok: false,
          stdout: '',
          stderr: 'Connection closed by example port 22',
          message: 'Connection closed by example port 22',
          remoteStarted: true,
          transportStderr: '',
        },
        target,
      ),
    ).toBeNull()
    expect(
      remoteRuntimeFailureReasonFromCommandResult(
        {
          ok: false,
          stdout: 'Connection to example closed by remote host.',
          stderr: '',
          message: 'Connection to example closed by remote host.',
          remoteStarted: true,
        },
        target,
      ),
    ).toBeNull()
    expect(
      remoteRuntimeFailureReasonFromCommandResult(
        {
          ok: false,
          stdout: '',
          stderr: '',
          message: 'Connection to example closed by remote host.',
          remoteStarted: true,
        },
        target,
      ),
    ).toBeNull()
    expect(
      remoteRuntimeFailureReasonFromCommandResult(
        {
          ok: false,
          stdout: '',
          stderr:
            'Connection to example interrupted before upstream closed\nConnection to github.com closed by remote host.',
          message:
            'Connection to example interrupted before upstream closed\nConnection to github.com closed by remote host.',
          remoteStarted: true,
        },
        target,
      ),
    ).toBeNull()
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
        message: 'error.workspace-runtime-stale',
      }),
    ).toBeNull()
  })
})
