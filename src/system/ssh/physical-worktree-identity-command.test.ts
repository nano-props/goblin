import { describe, expect, test } from 'vitest'
import { buildRemoteCommandInvocation } from '#/system/ssh/commands.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const target: RemoteWorkspaceTarget = {
  id: workspaceIdForTest('goblin+ssh://example/srv/repo'),
  alias: 'example',
  host: 'example.invalid',
  user: 'developer',
  port: 22,
  remotePath: '/srv/repo',
  displayName: 'example',
}

describe('remote physical worktree identity command', () => {
  test('publishes a user-scoped namespace atomically and canonicalizes the worktree', () => {
    const invocation = buildRemoteCommandInvocation(target, {
      type: 'resolvePhysicalWorktreeIdentity',
      path: '/srv/worktrees/feature',
    })

    expect(invocation.script).toContain('execution-namespace-id')
    expect(invocation.script).toContain('umask 077')
    expect(invocation.script).toContain('XDG_RUNTIME_DIR')
    expect(invocation.script).toContain('/tmp/goblin-runtime-$uid')
    expect(invocation.script).toContain('/etc/machine-id')
    expect(invocation.script).toContain('/proc/self/ns/mnt')
    expect(invocation.script).toContain('ln -- "$tmp" "$identity_file"')
    expect(invocation.script).toContain('pwd -P')
    expect(invocation.script).toContain("printf '%s\\0%s\\0%s\\0%s\\0%s\\0%s\\0'")
    expect(invocation.script).not.toContain('$HOME')
    expect(invocation.script).not.toContain('example.invalid')
  })

  test('resolves repository execution identity from the canonical Git common directory', () => {
    const invocation = buildRemoteCommandInvocation(target, {
      type: 'resolveRepoExecutionIdentity',
      path: '/srv/worktrees/feature',
    })

    expect(invocation.script).toContain('git -C')
    expect(invocation.script).toContain('rev-parse --git-common-dir')
    expect(invocation.script).toContain('cd -- "$common_dir" && pwd -P')
    expect(invocation.script).toContain('stat -c "%d %i" "$canonical"')
  })
})
