import { describe, expect, test } from 'vitest'
import { buildRemoteCommandInvocation } from '#/system/ssh/commands.ts'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'

const TARGET = normalizeRemoteTarget({
  alias: 'prod',
  host: 'example.com',
  user: 'alice',
  port: 22,
  remotePath: '/srv/repo',
})!

describe('remote command scripts', () => {
  test('renders remote branch listing command', () => {
    expect(buildRemoteCommandInvocation(TARGET, { type: 'gitRemoteBranches', path: '/srv/repo' }).script).toContain(
      "for-each-ref '--format=%(refname:short)' refs/remotes/",
    )
  })

  test('renders all worktree add modes', () => {
    expect(
      buildRemoteCommandInvocation(TARGET, {
        type: 'gitWorktreeAdd',
        path: '/srv/repo',
        input: { worktreePath: '/srv/repo-feature', mode: { kind: 'existingBranch', branch: 'feature/a' } },
      }).script,
    ).toContain("worktree add -- '/srv/repo-feature' 'feature/a'")

    expect(
      buildRemoteCommandInvocation(TARGET, {
        type: 'gitWorktreeAdd',
        path: '/srv/repo',
        input: {
          worktreePath: '/srv/repo-feature',
          mode: { kind: 'trackRemoteBranch', remoteRef: 'origin/feature/a', localBranch: 'feature/a' },
        },
      }).script,
    ).toContain("worktree add -b 'feature/a' --track -- '/srv/repo-feature' 'origin/feature/a'")

    expect(
      buildRemoteCommandInvocation(TARGET, {
        type: 'gitWorktreeAdd',
        path: '/srv/repo',
        input: { worktreePath: '/srv/repo-detached', mode: { kind: 'detached', ref: 'origin/feature/a' } },
      }).script,
    ).toContain("worktree add --detach -- '/srv/repo-detached' 'origin/feature/a'")
  })
})
