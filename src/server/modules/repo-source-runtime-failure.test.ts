import { beforeEach, describe, expect, test, vi } from 'vitest'
import { RemoteRepoRuntimeFailureError } from '#/server/modules/remote-runtime-failure.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

const target: RemoteRepoTarget = {
  id: 'ssh-config://prod/home/alice/service',
  alias: 'prod',
  remotePath: '/home/alice/service',
  displayName: 'prod:service',
  host: 'example.test',
  user: 'alice',
  port: 22,
}

const mocks = vi.hoisted(() => ({
  resolveRemoteTarget: vi.fn(),
  runRemoteCommand: vi.fn(),
}))

vi.mock('#/system/ssh/config.ts', () => ({
  resolveRemoteTarget: mocks.resolveRemoteTarget,
}))

vi.mock('#/system/ssh/commands.ts', () => ({
  SSH_BOOT_PROBE_TIMEOUT_MS: 10_000,
  REMOTE_SNAPSHOT_CURRENT_MARKER: '__GOBLIN_REMOTE_CURRENT__',
  REMOTE_SNAPSHOT_DEFAULT_MARKER: '__GOBLIN_REMOTE_DEFAULT__',
  REMOTE_SNAPSHOT_BRANCHES_MARKER: '__GOBLIN_REMOTE_BRANCHES__',
  runRemoteCommand: mocks.runRemoteCommand,
}))

describe('repo source runtime failure classification', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.resolveRemoteTarget.mockResolvedValue({ target })
  })

  test('throws a typed remote runtime failure for classified SSH transport failures', async () => {
    mocks.runRemoteCommand.mockResolvedValue({
      ok: false,
      stdout: '',
      stderr: 'ssh: connect to host example.test port 22: Connection refused',
      message: 'connection refused',
    })
    const { getRepoLog } = await import('#/server/modules/repo-read-paths.ts')

    await expect(
      getRepoLog(target.id, 'main', { repoRuntimeId: 'repo-runtime-test' }),
    ).rejects.toMatchObject({
      name: 'RemoteRepoRuntimeFailureError',
      repoRoot: target.id,
      repoRuntimeId: 'repo-runtime-test',
      reason: 'unreachable',
    } satisfies Partial<RemoteRepoRuntimeFailureError>)
  })

  test('throws a typed remote runtime failure for classified remote write failures', async () => {
    mocks.runRemoteCommand.mockResolvedValue({
      ok: false,
      stdout: '',
      stderr: 'ssh: connect to host example.test port 22: Connection refused',
      message: 'connection refused',
    })
    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')

    await expect(fetchRepo(target.id, 'user', undefined, 'repo-runtime-test')).rejects.toMatchObject({
      name: 'RemoteRepoRuntimeFailureError',
      repoRoot: target.id,
      repoRuntimeId: 'repo-runtime-test',
      reason: 'unreachable',
    } satisfies Partial<RemoteRepoRuntimeFailureError>)
  })

  test('preserves normal remote read failures when no runtime context is supplied', async () => {
    mocks.runRemoteCommand.mockResolvedValue({
      ok: false,
      stdout: '',
      stderr: 'ssh: connect to host example.test port 22: Connection refused',
      message: 'connection refused',
    })
    const { getRepoLog } = await import('#/server/modules/repo-read-paths.ts')

    await expect(getRepoLog(target.id, 'main')).rejects.toThrow('connection refused')
  })
})
