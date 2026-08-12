import { beforeEach, describe, expect, test, vi } from 'vitest'
import { RemoteWorkspaceRuntimeFailureError } from '#/server/modules/remote-workspace-runtime-failure.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { okRemoteResult, upstreamOutput, worktreePorcelain } from '#/system/ssh/git-test-utils.ts'
import { testWorkspaceRuntimeEpochCapability } from '#/server/test-utils/workspace-runtime-capability.ts'

const target: RemoteWorkspaceTarget = {
  id: workspaceIdForTest('goblin+ssh://prod/home/alice/service'),
  alias: 'prod',
  remotePath: '/home/alice/service',
  displayName: 'prod:service',
  host: 'example.test',
  user: 'alice',
  port: 22,
}

function runtimeCapability(workspaceRuntimeId: string) {
  return testWorkspaceRuntimeEpochCapability({
    userId: 'test-user',
    workspaceId: target.id,
    workspaceRuntimeId,
  })
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

    await expect(getRepoLog(target.id, 'main', { workspaceRuntimeId: 'repo-runtime-test' })).rejects.toMatchObject({
      name: 'RemoteWorkspaceRuntimeFailureError',
      workspaceId: target.id,
      workspaceRuntimeId: 'repo-runtime-test',
      reason: 'unreachable',
    } satisfies Partial<RemoteWorkspaceRuntimeFailureError>)
  })

  test('throws a typed remote runtime failure for classified remote write failures', async () => {
    mocks.runRemoteCommand.mockResolvedValue({
      ok: false,
      stdout: '',
      stderr: 'ssh: connect to host example.test port 22: Connection refused',
      message: 'connection refused',
    })
    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')

    await expect(fetchRepo(target.id, runtimeCapability('repo-runtime-test'), 'user', undefined)).rejects.toMatchObject(
      {
        name: 'RemoteWorkspaceRuntimeFailureError',
        workspaceId: target.id,
        workspaceRuntimeId: 'repo-runtime-test',
        reason: 'unreachable',
      } satisfies Partial<RemoteWorkspaceRuntimeFailureError>,
    )
  })

  test('records a mutation transport failure without throwing before the domain consumes the result', async () => {
    const commandResult = {
      ok: false as const,
      stdout: '',
      stderr: '',
      transportStderr: 'client_loop: send disconnect: Broken pipe',
      message: 'connection lost',
      remoteStarted: true,
    }
    mocks.runRemoteCommand.mockResolvedValue(commandResult)
    const { createRemoteMutationAttempt } = await import('#/server/modules/remote-repo-execution.ts')
    const attempt = createRemoteMutationAttempt(target.id, 'repo-runtime-test', target)

    await expect(
      attempt.run(
        {
          type: 'gitPush',
          path: target.remotePath,
          remote: 'origin',
          branch: 'feature/test',
          targetBranch: 'feature/test',
          setUpstream: false,
        },
        target,
      ),
    ).resolves.toBe(commandResult)
    expect(attempt.capturedRuntimeFailure()).toMatchObject({
      name: 'RemoteWorkspaceRuntimeFailureError',
      workspaceId: target.id,
      workspaceRuntimeId: 'repo-runtime-test',
      reason: 'unreachable',
    } satisfies Partial<RemoteWorkspaceRuntimeFailureError>)
  })

  test('carries mutation impact established from a raw SSH transport failure', async () => {
    mocks.runRemoteCommand.mockImplementation(async (_target, command: { type: string }) => {
      switch (command.type) {
        case 'resolveRepoCommonDir':
          return okRemoteResult(`${target.remotePath}/.git\0`)
        case 'gitWorktreeList':
          return okRemoteResult(
            worktreePorcelain(`worktree ${target.remotePath}\nHEAD f00ba40\nbranch refs/heads/main`),
          )
        case 'gitRemoteVerbose':
          return okRemoteResult(
            'origin\tgit@example.test:project/repo.git (fetch)\norigin\tgit@example.test:project/repo.git (push)',
          )
        case 'gitUpstream':
          return okRemoteResult(upstreamOutput('origin', 'feature/test'))
        case 'gitPush':
          return {
            ok: false,
            stdout: '',
            stderr: '',
            transportStderr: 'client_loop: send disconnect: Broken pipe',
            message: 'connection lost',
            remoteStarted: true,
          }
        default:
          throw new Error(`unexpected remote command: ${command.type}`)
      }
    })
    const { pushRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    await expect(
      pushRepoBranch(target.id, 'feature/test', runtimeCapability('repo-runtime-test'), undefined),
    ).rejects.toMatchObject({
      name: 'RepoMutationRuntimeFailureError',
      mutation: {
        ok: false,
        message: 'connection lost',
        repoIdsToInvalidate: [target.id],
      },
      runtimeFailure: {
        workspaceId: target.id,
        workspaceRuntimeId: 'repo-runtime-test',
        reason: 'unreachable',
      },
    })
  })

  test('carries a confirmed local branch deletion from raw SSH results', async () => {
    mocks.runRemoteCommand.mockImplementation(async (_target, command: { type: string }) => {
      switch (command.type) {
        case 'gitWorktreeList':
          return okRemoteResult(
            worktreePorcelain(`worktree ${target.remotePath}\nHEAD f00ba40\nbranch refs/heads/main`),
          )
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'value main',
              '__GOBLIN_REMOTE_DEFAULT__',
              'value main',
              '__GOBLIN_REMOTE_BRANCHES__',
              '',
            ].join('\n'),
          )
        case 'gitRemoteVerbose':
          return okRemoteResult('')
        case 'gitUpstream':
          return okRemoteResult(upstreamOutput('origin', 'feature/test'))
        case 'gitBranchDelete':
          return okRemoteResult('deleted local branch')
        case 'gitPushDeleteBranch':
          return {
            ok: false,
            stdout: '',
            stderr: '',
            transportStderr: 'client_loop: send disconnect: Broken pipe',
            message: 'connection lost',
            remoteStarted: true,
          }
        default:
          throw new Error(`unexpected remote command: ${command.type}`)
      }
    })
    const { runWithRepoSource } = await import('#/server/modules/repo-source.ts')

    await expect(
      runWithRepoSource(
        target.id,
        async (source) => await source.deleteBranch('feature/test', { force: true, deleteUpstream: true }),
        { workspaceRuntimeId: 'repo-runtime-test' },
      ),
    ).rejects.toMatchObject({
      name: 'RepoMutationRuntimeFailureError',
      mutation: {
        ok: false,
        message: 'connection lost',
        recoveryMessageKeys: ['error.local-branch-deleted-followup-failed'],
        repoIdsToInvalidate: [target.id],
      },
      runtimeFailure: {
        workspaceId: target.id,
        workspaceRuntimeId: 'repo-runtime-test',
        reason: 'unreachable',
      },
    })
  })

  test('carries confirmed worktree and branch milestones from raw SSH results', async () => {
    const linkedPath = `${target.remotePath}-feature`
    const linkedWorkspaceId = workspaceIdForTest('goblin+ssh://prod/home/alice/service-feature')
    mocks.runRemoteCommand.mockImplementation(async (_target, command: { type: string }) => {
      switch (command.type) {
        case 'gitWorktreeList':
          return okRemoteResult(
            worktreePorcelain(
              [
                `worktree ${target.remotePath}`,
                'HEAD f00ba40',
                'branch refs/heads/main',
                '',
                `worktree ${linkedPath}`,
                'HEAD ba5eba1',
                'branch refs/heads/feature/test',
              ].join('\n'),
            ),
          )
        case 'gitStatus':
          return okRemoteResult('')
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'value main',
              '__GOBLIN_REMOTE_DEFAULT__',
              'value main',
              '__GOBLIN_REMOTE_BRANCHES__',
              '',
            ].join('\n'),
          )
        case 'gitUpstream':
          return okRemoteResult(upstreamOutput('origin', 'feature/test'))
        case 'gitWorktreeRemove':
          return okRemoteResult('removed worktree')
        case 'gitBranchDelete':
          return okRemoteResult('deleted local branch')
        case 'gitPushDeleteBranch':
          return {
            ok: false,
            stdout: '',
            stderr: '',
            transportStderr: 'client_loop: send disconnect: Broken pipe',
            message: 'connection lost',
            remoteStarted: true,
          }
        default:
          throw new Error(`unexpected remote command: ${command.type}`)
      }
    })
    const { runWithRepoSource } = await import('#/server/modules/repo-source.ts')

    await expect(
      runWithRepoSource(
        target.id,
        async (source) =>
          await source.removeWorktree(
            {
              branch: 'feature/test',
              worktreePath: linkedPath,
              deleteBranch: true,
              forceDeleteBranch: true,
              deleteUpstream: true,
            },
            undefined,
            {
              beforeRemove: async () => ({ ok: true, message: '' }),
              afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
            },
            async (mutation) => await mutation(),
          ),
        { workspaceRuntimeId: 'repo-runtime-test' },
      ),
    ).rejects.toMatchObject({
      name: 'RepoMutationRuntimeFailureError',
      mutation: {
        ok: false,
        message: 'connection lost',
        recoveryMessageKeys: ['error.worktree-removed-followup-failed', 'error.local-branch-deleted-followup-failed'],
        repoIdsToInvalidate: [target.id, linkedWorkspaceId],
      },
      runtimeFailure: {
        workspaceId: target.id,
        workspaceRuntimeId: 'repo-runtime-test',
        reason: 'unreachable',
      },
    })
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

  test('throws a typed remote runtime failure when target resolution fails under runtime context', async () => {
    mocks.resolveRemoteTarget.mockRejectedValueOnce(new Error('error.ssh-config-changed'))
    const { getRepoLog } = await import('#/server/modules/repo-read-paths.ts')

    await expect(getRepoLog(target.id, 'main', { workspaceRuntimeId: 'repo-runtime-test' })).rejects.toMatchObject({
      name: 'RemoteWorkspaceRuntimeFailureError',
      workspaceId: target.id,
      workspaceRuntimeId: 'repo-runtime-test',
      reason: 'config-changed',
    } satisfies Partial<RemoteWorkspaceRuntimeFailureError>)
  })
})
