import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ExecaError } from 'execa'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const mocks = vi.hoisted(() => ({
  chmod: vi.fn(),
  execa: vi.fn(),
  mkdir: vi.fn(),
}))

vi.mock('execa', () => ({
  ExecaError: class ExecaError extends Error {},
  execa: mocks.execa,
}))

vi.mock('node:fs/promises', () => ({
  chmod: mocks.chmod,
  mkdir: mocks.mkdir,
}))

import { REMOTE_UNSUPPORTED_PLATFORM_MARKER, runRemoteCommand } from '#/system/ssh/commands.ts'
import { classifySshFailure } from '#/system/ssh/diagnostics.ts'

const REMOTE_COMMAND_STARTED_MARKER = '__GOBLIN_REMOTE_COMMAND_STARTED__'
const REMOTE_COMMAND_STDERR_BEGIN_MARKER = '__GOBLIN_REMOTE_COMMAND_STDERR_BEGIN__'
const REMOTE_COMMAND_STDERR_END_MARKER = '__GOBLIN_REMOTE_COMMAND_STDERR_END__'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.chmod.mockResolvedValue(undefined)
  mocks.mkdir.mockResolvedValue(undefined)
})

describe('runRemoteCommand', () => {
  test('reports a control-directory preparation failure before SSH as not started', async () => {
    mocks.mkdir.mockRejectedValueOnce(new Error('control directory is read-only'))

    await expect(runRemoteCommand(target(), { type: 'checkShell' })).resolves.toEqual({
      ok: false,
      stdout: '',
      stderr: '',
      message: 'control directory is read-only',
      commandNotStarted: true,
    })
    expect(mocks.execa).not.toHaveBeenCalled()
  })

  test('marks the remote shell as started and strips the marker from successful stdout', async () => {
    const signal = new AbortController().signal
    mocks.execa.mockResolvedValueOnce({
      stdout: `${REMOTE_COMMAND_STARTED_MARKER}\n/home/deploy\n`,
      stderr: 'ignored warning\n',
    })

    await expect(runRemoteCommand(target(), { type: 'printHome' }, { signal, timeoutMs: 1234 })).resolves.toEqual({
      ok: true,
      stdout: '/home/deploy',
      stderr: 'ignored warning',
      remoteStarted: true,
    })

    const args = mocks.execa.mock.calls[0]?.[1] as string[]
    const script = args.at(-1) ?? ''
    expect(script).toContain(REMOTE_COMMAND_STARTED_MARKER)
    expectScriptOrder(script, [
      REMOTE_COMMAND_STARTED_MARKER,
      'goblin_old_umask=$(umask)',
      'umask 077',
      ': >"$goblin_stderr"',
      'umask "$goblin_old_umask"',
      '$HOME',
    ])
    expect(mocks.execa).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        cancelSignal: signal,
        forceKillAfterDelay: 500,
        timeout: 1234,
      }),
    )
  })

  test('rejects SSH exit zero when the remote command protocol did not start', async () => {
    mocks.execa.mockResolvedValueOnce({ stdout: '', stderr: '' })

    await expect(runRemoteCommand(target(), { type: 'checkShell' })).resolves.toEqual({
      ok: false,
      stdout: '',
      stderr: '',
      message: 'remote command execution could not be confirmed',
      remoteStarted: false,
      remoteStartUnconfirmed: true,
    })
  })

  test('preserves unexpected server output when SSH exit zero bypasses the remote command protocol', async () => {
    mocks.execa.mockResolvedValueOnce({ stdout: 'forced command output\n', stderr: 'server notice\n' })

    await expect(runRemoteCommand(target(), { type: 'checkShell' })).resolves.toEqual({
      ok: false,
      stdout: 'forced command output',
      stderr: 'server notice',
      message: 'remote command execution could not be confirmed',
      remoteStarted: false,
      remoteStartUnconfirmed: true,
    })
  })

  test('preserves remoteStarted on command failures after the remote shell starts', async () => {
    mocks.execa.mockRejectedValueOnce({
      stdout: `${REMOTE_COMMAND_STARTED_MARKER}\n`,
      stderr: [
        REMOTE_COMMAND_STDERR_BEGIN_MARKER,
        'git@github.com: Permission denied (publickey).',
        REMOTE_COMMAND_STDERR_END_MARKER,
        '',
      ].join('\n'),
      message: 'Command failed',
    })

    await expect(
      runRemoteCommand(target(), { type: 'gitFetchRemote', path: '/srv/repo', remote: 'origin' }),
    ).resolves.toEqual({
      ok: false,
      stdout: '',
      stderr: 'git@github.com: Permission denied (publickey).',
      message: 'git@github.com: Permission denied (publickey).',
      remoteStarted: true,
      transportStderr: '',
    })
  })

  test('preserves an unsupported platform marker through runner framing', async () => {
    mocks.execa.mockRejectedValueOnce({
      stdout: `${REMOTE_COMMAND_STARTED_MARKER}\n${REMOTE_UNSUPPORTED_PLATFORM_MARKER}Darwin\n`,
      stderr: [REMOTE_COMMAND_STDERR_BEGIN_MARKER, REMOTE_COMMAND_STDERR_END_MARKER, ''].join('\n'),
      message: 'Command failed',
    })

    const result = await runRemoteCommand(target(), { type: 'checkShell' })

    expect(result).toMatchObject({
      ok: false,
      stdout: `${REMOTE_UNSUPPORTED_PLATFORM_MARKER}Darwin`,
      remoteStarted: true,
    })
    expect(classifySshFailure(result)).toBe('unsupported-platform')
  })

  test('keeps post-start SSH client diagnostics separate from remote command stderr', async () => {
    mocks.execa.mockRejectedValueOnce({
      stdout: `${REMOTE_COMMAND_STARTED_MARKER}\n`,
      stderr: [
        'Connection to prod closed by remote host.',
        REMOTE_COMMAND_STDERR_BEGIN_MARKER,
        'remote command stderr',
        REMOTE_COMMAND_STDERR_END_MARKER,
        'client_loop: send disconnect: Broken pipe',
        '',
      ].join('\n'),
      message: 'Command failed',
    })

    await expect(runRemoteCommand(target(), { type: 'gitStatus', path: '/srv/repo' })).resolves.toEqual({
      ok: false,
      stdout: '',
      stderr: 'remote command stderr',
      message: 'remote command stderr',
      remoteStarted: true,
      transportStderr: 'Connection to prod closed by remote host.\nclient_loop: send disconnect: Broken pipe',
    })
  })

  test('does not treat unframed post-start stderr as separated transport diagnostics', async () => {
    mocks.execa.mockRejectedValueOnce({
      stdout: `${REMOTE_COMMAND_STARTED_MARKER}\n`,
      stderr: 'Connection to prod closed by remote host.\n',
      message: 'Command failed',
    })

    await expect(runRemoteCommand(target(), { type: 'gitStatus', path: '/srv/repo' })).resolves.toEqual({
      ok: false,
      stdout: '',
      stderr: 'Connection to prod closed by remote host.',
      message: 'Connection to prod closed by remote host.',
      remoteStarted: true,
      transportStderr: '',
    })
  })

  test('leaves remoteStarted false when ssh fails before printing the marker', async () => {
    mocks.execa.mockRejectedValueOnce({
      stdout: '',
      stderr: 'ssh: connect to host example.test port 22: Connection refused\n',
      message: 'Command failed',
    })

    await expect(runRemoteCommand(target(), { type: 'checkShell' })).resolves.toEqual({
      ok: false,
      stdout: '',
      stderr: 'ssh: connect to host example.test port 22: Connection refused',
      message: 'ssh: connect to host example.test port 22: Connection refused',
      remoteStarted: false,
    })
  })

  test('reports a provable SSH process start failure as not started', async () => {
    const failure = Object.assign(new ExecaError(), {
      message: 'ssh executable was not found',
      code: 'ENOENT',
      exitCode: undefined,
      signal: undefined,
    })
    mocks.execa.mockRejectedValueOnce(failure)

    await expect(runRemoteCommand(target(), { type: 'checkShell' })).resolves.toEqual({
      ok: false,
      stdout: '',
      stderr: '',
      message: 'ssh executable was not found',
      commandNotStarted: true,
    })
  })
})

function target(): RemoteWorkspaceTarget {
  return {
    id: workspaceIdForTest('goblin+ssh://prod/srv/repo'),
    alias: 'prod',
    host: 'example.test',
    user: 'deploy',
    port: 22,
    remotePath: '/srv/repo',
    displayName: 'prod:repo',
  }
}

function expectScriptOrder(script: string, tokens: readonly string[]): void {
  let previous = -1
  for (const token of tokens) {
    const index = script.indexOf(token)
    expect(index).toBeGreaterThan(previous)
    previous = index
  }
}
