import { mkdtempDisposable, mkdir, realpath, stat, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
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
    expect(invocation.script).not.toContain('/var/lib/dbus/machine-id')
    expect(invocation.script).not.toContain('uname -n')
    expect(invocation.script).not.toContain('stat -c "%d:%i"')
    expect(invocation.script).toContain('ln -- "$tmp" "$identity_file"')
    expect(invocation.script).toContain('pwd -P')
    expect(invocation.script).toContain("printf '%s\\0%s\\0%s\\0%s\\0'")
    expect(invocation.script).not.toContain('endpoint_stat')
    expect(invocation.script).not.toContain('$HOME')
    expect(invocation.script).not.toContain('example.invalid')
  })

  test.runIf(process.platform === 'linux')('executes with stable framing and a canonical symlink target', async () => {
    await using temporaryRoot = await mkdtempDisposable(path.join(os.tmpdir(), 'goblin-physical-identity-'))
    const runtime = path.join(temporaryRoot.path, 'runtime')
    const worktree = path.join(temporaryRoot.path, 'worktree')
    const link = path.join(temporaryRoot.path, 'worktree-link')
    await mkdir(runtime)
    await mkdir(worktree)
    await symlink(worktree, link)
    const invocation = buildRemoteCommandInvocation(target, {
      type: 'resolvePhysicalWorktreeIdentity',
      path: link,
    })
    const env = { ...process.env, XDG_RUNTIME_DIR: runtime }

    const [first, second] = await Promise.all([
      execa('sh', ['-c', invocation.script], { env }),
      execa('sh', ['-c', invocation.script], { env }),
    ])

    expect(second.stdout).toBe(first.stdout)
    const [runtimeToken, machineFact, namespaceFact, endpoint, trailing] = first.stdout.split('\0')
    expect(runtimeToken).toMatch(/^[a-f0-9]{32}$/u)
    expect(machineFact).toBeTruthy()
    expect(namespaceFact).toBeTruthy()
    expect(endpoint).toBe(await realpath(worktree))
    expect(trailing).toBe('')
    expect((await stat(runtime)).mode & 0o777).toBe(0o700)
    expect((await stat(path.join(runtime, 'goblin', 'execution-namespace-id'))).mode & 0o777).toBe(0o600)
  })

  test('resolves the canonical Git common directory without generation facts', () => {
    const invocation = buildRemoteCommandInvocation(target, {
      type: 'resolveRepoCommonDir',
      path: '/srv/worktrees/feature',
    })

    expect(invocation.script).toContain('git -C')
    expect(invocation.script).toContain('rev-parse --git-common-dir')
    expect(invocation.script).toContain('cd -- "$common_dir" && pwd -P')
    expect(invocation.script).not.toContain('stat -c')
    expect(invocation.script).not.toContain('rev-parse --git-path objects')
    expect(invocation.script).toContain('printf \'%s\\0\' "$canonical"')
  })
})
