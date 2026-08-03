import { describe, expect, test } from 'vitest'
import { remoteWorkspaceRuntimeFailureReasonFromCommandResult } from '#/server/modules/remote-workspace-runtime-failure.ts'
import type { RemoteWorkspaceFailureReason, RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import type { RemoteCommandResult } from '#/system/ssh/commands.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const target: RemoteWorkspaceTarget = {
  id: workspaceIdForTest('goblin+ssh://example/srv/repo'),
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

function failedCommand(overrides: Partial<RemoteCommandResult>): RemoteCommandResult {
  return { ok: false, stdout: '', stderr: '', ...overrides }
}

function startedRemoteCommand(overrides: Partial<RemoteCommandResult>): RemoteCommandResult {
  return failedCommand({ remoteStarted: true, transportStderr: '', ...overrides })
}

describe('remote runtime failure classification', () => {
  describe('before the remote shell starts', () => {
    test.each([
      ['explicit timeout', { message: 'timeout', timedOut: true }, 'timeout'],
      [
        'connection timeout',
        { stderr: 'ssh: connect to host example.test port 22: Operation timed out' },
        'unreachable',
      ],
      [
        'key exchange reset',
        { stderr: 'kex_exchange_identification: read: Connection reset by peer' },
        'handshake-failed',
      ],
      ['host key rejection', { stderr: 'Host key verification failed.' }, 'host-key'],
      [
        'authentication rejection',
        { stderr: 'Received disconnect from 192.0.2.1 port 22:2: Too many authentication failures' },
        'auth-failed',
      ],
      [
        'key exchange close',
        { stderr: 'kex_exchange_identification: Connection closed by UNKNOWN port 65535' },
        'handshake-failed',
      ],
    ] satisfies ReadonlyArray<
      readonly [name: string, input: Partial<RemoteCommandResult>, expected: RemoteWorkspaceFailureReason]
    >)('classifies %s', (_name, input, expected) => {
      expect(remoteWorkspaceRuntimeFailureReasonFromCommandResult(failedCommand(input))).toBe(expected)
    })

    test('fails the runtime when SSH exits zero without establishing the remote command protocol', () => {
      expect(
        remoteWorkspaceRuntimeFailureReasonFromCommandResult(
          failedCommand({
            message: 'remote command execution could not be confirmed',
            remoteStarted: false,
            remoteStartUnconfirmed: true,
          }),
        ),
      ).toBe('handshake-failed')
    })
  })

  describe('after the remote shell starts', () => {
    test.each([
      ['upstream authentication failure', 'git@github.com: Permission denied (publickey).', {}],
      ['upstream host key failure', 'Host key verification failed.', {}],
      ['remote timeout text', 'timeout', {}],
      ['remote timedOut flag', 'timeout', { timedOut: true }],
    ] satisfies ReadonlyArray<readonly [name: string, message: string, extra: Partial<RemoteCommandResult>]>)(
      'does not classify %s as a transport failure',
      (_name, message, extra) => {
        expect(
          remoteWorkspaceRuntimeFailureReasonFromCommandResult(
            startedRemoteCommand({ stderr: message, message, ...extra }),
          ),
        ).toBeNull()
      },
    )

    test.each([
      ['remote host close', 'Connection to example closed by remote host.'],
      ['OpenSSH client loop failure', 'client_loop: send disconnect: Broken pipe'],
      [
        'OpenSSH client loop failure with trailing close',
        'client_loop: send disconnect: Broken pipe\nConnection to example closed.',
      ],
      ['destination close', 'Connection closed by example port 22'],
      ['destination reset', 'Connection reset by example port 22'],
      ['destination broken pipe', 'Connection to example port 22: Broken pipe'],
      ['destination remote host close', 'Connection to example port 22: Connection closed by remote host'],
    ])('classifies current SSH session %s', (_name, transportStderr) => {
      expect(
        remoteWorkspaceRuntimeFailureReasonFromCommandResult(
          startedRemoteCommand({ transportStderr, message: transportStderr }),
          target,
        ),
      ).toBe('unreachable')
    })

    test.each([
      [
        'upstream host close in command stderr',
        startedRemoteCommand({
          stderr: 'Connection to github.com closed by remote host.',
          message: 'Connection to github.com closed by remote host.',
        }),
      ],
      [
        'wrong destination port in transport stderr',
        startedRemoteCommand({
          transportStderr: 'Connection closed by example port 222',
          message: 'Connection closed by example port 222',
        }),
      ],
      [
        'client loop failure in command stderr',
        startedRemoteCommand({
          stderr: 'client_loop: send disconnect: Broken pipe',
          message: 'client_loop: send disconnect: Broken pipe',
        }),
      ],
      [
        'upstream destination close in command stderr',
        startedRemoteCommand({
          stderr: 'Connection closed by github.com port 22',
          message: 'Connection closed by github.com port 22',
        }),
      ],
      [
        'upstream broken pipe in command stderr',
        startedRemoteCommand({
          stderr: 'Connection to github.com port 22: Broken pipe',
          message: 'Connection to github.com port 22: Broken pipe',
        }),
      ],
      [
        'current destination close in command stderr',
        startedRemoteCommand({
          stderr: 'Connection closed by example port 22',
          message: 'Connection closed by example port 22',
        }),
      ],
      [
        'current destination close in command stdout without a separated transport stream',
        failedCommand({
          stdout: 'Connection to example closed by remote host.',
          message: 'Connection to example closed by remote host.',
          remoteStarted: true,
        }),
      ],
      [
        'current destination close in the message without a separated transport stream',
        failedCommand({ message: 'Connection to example closed by remote host.', remoteStarted: true }),
      ],
      [
        'mixed destination text without a separated transport stream',
        failedCommand({
          stderr:
            'Connection to example interrupted before upstream closed\nConnection to github.com closed by remote host.',
          message:
            'Connection to example interrupted before upstream closed\nConnection to github.com closed by remote host.',
          remoteStarted: true,
        }),
      ],
    ] satisfies ReadonlyArray<readonly [name: string, result: RemoteCommandResult]>)(
      'does not classify %s',
      (_name, result) => {
        expect(remoteWorkspaceRuntimeFailureReasonFromCommandResult(result, target)).toBeNull()
      },
    )
  })

  test.each([
    ['ordinary command failure', { stderr: 'fatal: not a git repository' }],
    ['stale runtime', { message: 'error.workspace-runtime-stale' }],
  ])('does not classify %s as a reachability failure', (_name, input) => {
    expect(remoteWorkspaceRuntimeFailureReasonFromCommandResult(failedCommand(input))).toBeNull()
  })
})
