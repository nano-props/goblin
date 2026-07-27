import { describe, expect, test, vi } from 'vitest'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import { normalizeRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import type { WorkspaceRuntimeClosedEvent } from '#/server/modules/workspace-runtimes.ts'
import { PhysicalWorktreeIdentityResolver } from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const LOCAL_INPUT = {
  userId: 'user-1',
  workspaceId: workspaceIdForTest('goblin+file:///repos/main'),
  workspaceRuntimeId: 'repo-runtime-1',
  worktreePath: '/worktrees/alias',
}
describe('PhysicalWorktreeIdentityResolver', () => {
  test('captures the local workspace root without requiring Git worktree membership', async () => {
    const getLocalWorktrees = vi.fn()
    const resolver = new PhysicalWorktreeIdentityResolver({
      getLocalWorktrees,
      async nativeRealpath(input) {
        return input
      },
      isCurrentWorkspaceRuntime: () => true,
      onWorkspaceRuntimeClosed: () => () => undefined,
    })

    await expect(resolver.capture({ ...LOCAL_INPUT, worktreePath: '/repos/main' })).resolves.toMatchObject({
      identity: { kind: 'local', endpoint: '/repos/main' },
    })
    expect(getLocalWorktrees).not.toHaveBeenCalled()
    resolver.dispose()
  })

  test('freshly resolves and canonicalizes every local operation', async () => {
    let worktreeReads = 0
    const getLocalWorktrees = vi.fn(async () => {
      worktreeReads += 1
      return [{ path: LOCAL_INPUT.worktreePath } as WorktreeInfo]
    })
    const resolver = new PhysicalWorktreeIdentityResolver({
      getLocalWorktrees,
      async nativeRealpath() {
        return '/volumes/repo/worktrees/feature'
      },
      isCurrentWorkspaceRuntime: () => true,
      onWorkspaceRuntimeClosed: () => () => undefined,
    })

    await expect(resolver.capture(LOCAL_INPUT)).resolves.toMatchObject({
      identity: {
        kind: 'local',
        executionNamespaceId: 'local',
        endpoint: '/volumes/repo/worktrees/feature',
      },
    })
    await expect(resolver.capture(LOCAL_INPUT)).resolves.toMatchObject({
      identity: { endpoint: '/volumes/repo/worktrees/feature' },
    })
    expect(worktreeReads).toBe(2)
    expect(getLocalWorktrees).toHaveBeenCalledWith('/repos/main', expect.any(AbortSignal))
    resolver.dispose()
  })

  test('accepts a same-path worktree recreated during one runtime', async () => {
    let present = true
    const resolver = new PhysicalWorktreeIdentityResolver({
      async getLocalWorktrees() {
        return present ? [{ path: LOCAL_INPUT.worktreePath } as WorktreeInfo] : []
      },
      async nativeRealpath() {
        return '/volumes/repo/worktrees/feature'
      },
      isCurrentWorkspaceRuntime: () => true,
      onWorkspaceRuntimeClosed: () => () => undefined,
    })

    await resolver.capture(LOCAL_INPUT)
    present = false
    await expect(resolver.capture(LOCAL_INPUT)).rejects.toThrow('error.invalid-worktree-path')
    present = true
    await expect(resolver.capture(LOCAL_INPUT)).resolves.toMatchObject({
      identity: { endpoint: '/volumes/repo/worktrees/feature' },
    })
    resolver.dispose()
  })

  test('recaptures remote identity under one stable SSH configuration', async () => {
    const workspaceId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    let remoteOutput = remoteIdentityOutput('0123456789abcdef0123456789abcdef', 'machine-a', 'mnt-a')
    const runRemoteCommand = vi.fn(async () => ({ ok: true, stdout: remoteOutput, stderr: '' }))
    const resolver = new PhysicalWorktreeIdentityResolver({
      async resolveRemoteTarget() {
        return {
          target: {
            id: workspaceId,
            alias: 'prod',
            host: 'example.invalid',
            user: 'developer',
            port: 22,
            remotePath: '/srv/repo',
            displayName: 'prod',
          },
          configFingerprint: 'same-ssh-config',
        }
      },
      async resolveRemoteWorktree(_target, worktreePath) {
        return { path: worktreePath } as WorktreeInfo
      },
      runRemoteCommand,
      isCurrentWorkspaceRuntime: () => true,
      onWorkspaceRuntimeClosed: () => () => undefined,
    })
    const input = { ...LOCAL_INPUT, workspaceId, worktreePath: '/srv/worktrees/feature' }

    await resolver.capture(input)
    remoteOutput = remoteIdentityOutput('fedcba9876543210fedcba9876543210', 'machine-b', 'mnt-b')
    await expect(resolver.capture(input)).resolves.toMatchObject({
      identity: { kind: 'remote', endpoint: '/srv/worktrees/feature' },
    })
    expect(runRemoteCommand).toHaveBeenCalledTimes(2)
    resolver.dispose()
  })

  test.each([
    ['/srv/repo', '/srv/repo'],
    ['/srv/repo', '/srv/worktrees/feature'],
    ['/srv/worktrees/feature', '/srv/repo'],
  ])('fails fast when SSH configuration changes between %s and %s', async (firstPath, secondPath) => {
    const workspaceId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    let configFingerprint = 'config-a'
    const runRemoteCommand = vi.fn(async (command) => {
      if (command.type !== 'resolvePhysicalWorktreeIdentity') throw new Error('unexpected command')
      return {
        ok: true,
        stdout: remoteIdentityOutput('0123456789abcdef0123456789abcdef', 'machine-a', 'mnt-a', command.path),
        stderr: '',
      }
    })
    const resolver = new PhysicalWorktreeIdentityResolver({
      async resolveRemoteTarget() {
        return {
          target: {
            id: workspaceId,
            alias: 'prod',
            host: 'example.invalid',
            user: 'developer',
            port: 22,
            remotePath: '/srv/repo',
            displayName: 'prod',
          },
          configFingerprint,
        }
      },
      async resolveRemoteWorktree(_target, worktreePath) {
        return { path: worktreePath } as WorktreeInfo
      },
      runRemoteCommand,
      isCurrentWorkspaceRuntime: () => true,
      onWorkspaceRuntimeClosed: () => () => undefined,
    })
    await resolver.capture({ ...LOCAL_INPUT, workspaceId, worktreePath: firstPath })
    configFingerprint = 'config-b'
    await expect(resolver.capture({ ...LOCAL_INPUT, workspaceId, worktreePath: secondPath })).rejects.toThrow(
      'error.workspace-runtime-stale',
    )
    expect(runRemoteCommand).toHaveBeenCalledOnce()
    resolver.dispose()
  })

  test('classifies transport failures while resolving the remote worktree list', async () => {
    const workspaceId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const resolver = new PhysicalWorktreeIdentityResolver({
      async resolveRemoteTarget() {
        return {
          target: {
            id: workspaceId,
            alias: 'prod',
            host: 'example.invalid',
            user: 'developer',
            port: 22,
            remotePath: '/srv/repo',
            displayName: 'prod',
          },
          configFingerprint: 'same-ssh-config',
        }
      },
      async resolveRemoteWorktree(target, worktreePath, options = {}) {
        await options.run?.({ type: 'gitWorktreeList', path: target.remotePath }, target, { signal: options.signal })
        return { path: worktreePath } as WorktreeInfo
      },
      async runRemoteCommand() {
        return {
          ok: false,
          stdout: '',
          stderr: 'ssh_exchange_identification: Connection closed by remote host',
          message: 'ssh failed',
        }
      },
      isCurrentWorkspaceRuntime: () => true,
      onWorkspaceRuntimeClosed: () => () => undefined,
    })

    await expect(
      resolver.capture({ ...LOCAL_INPUT, workspaceId, worktreePath: '/srv/worktrees/feature' }),
    ).rejects.toMatchObject({
      name: 'RemoteWorkspaceRuntimeFailureError',
      workspaceId: workspaceId,
      workspaceRuntimeId: LOCAL_INPUT.workspaceRuntimeId,
      reason: 'handshake-failed',
    })
    resolver.dispose()
  })

  test('fences a deferred resolve when its workspace runtime closes', async () => {
    const worktrees = Promise.withResolvers<WorktreeInfo[]>()
    let current = true
    let closedListener: (event: WorkspaceRuntimeClosedEvent) => void = () => undefined
    const resolver = new PhysicalWorktreeIdentityResolver({
      async getLocalWorktrees() {
        return await worktrees.promise
      },
      async nativeRealpath(input) {
        return input
      },
      isCurrentWorkspaceRuntime: () => current,
      onWorkspaceRuntimeClosed(listener) {
        closedListener = listener
        return () => undefined
      },
    })

    const pending = resolver.capture(LOCAL_INPUT)
    current = false
    closedListener({
      userId: LOCAL_INPUT.userId,
      workspaceId: LOCAL_INPUT.workspaceId,
      workspaceRuntimeId: LOCAL_INPUT.workspaceRuntimeId,
    })
    worktrees.resolve([{ path: LOCAL_INPUT.worktreePath } as WorktreeInfo])

    await expect(pending).rejects.toThrow('error.workspace-runtime-stale')
    await expect(resolver.capture(LOCAL_INPUT)).rejects.toThrow('error.workspace-runtime-stale')
    resolver.dispose()
  })

  test('keeps a shared resolve alive when only one waiter aborts', async () => {
    const worktrees = Promise.withResolvers<WorktreeInfo[]>()
    const getLocalWorktrees = vi.fn(async () => await worktrees.promise)
    const resolver = new PhysicalWorktreeIdentityResolver({
      getLocalWorktrees,
      async nativeRealpath(input) {
        return input
      },
      isCurrentWorkspaceRuntime: () => true,
      onWorkspaceRuntimeClosed: () => () => undefined,
    })
    const waiter = new AbortController()
    const first = resolver.capture({ ...LOCAL_INPUT, signal: waiter.signal })
    const second = resolver.capture(LOCAL_INPUT)

    waiter.abort(new Error('waiter-cancelled'))
    await expect(first).rejects.toThrow('waiter-cancelled')
    worktrees.resolve([{ path: LOCAL_INPUT.worktreePath } as WorktreeInfo])
    await expect(second).resolves.toMatchObject({ identity: { endpoint: LOCAL_INPUT.worktreePath } })
    expect(getLocalWorktrees).toHaveBeenCalledOnce()
    resolver.dispose()
  })

  test('workspace runtime close aborts every waiter for the shared resolve', async () => {
    let closedListener: (event: WorkspaceRuntimeClosedEvent) => void = () => undefined
    const resolver = new PhysicalWorktreeIdentityResolver({
      async getLocalWorktrees(_workspacePath, signal) {
        return await new Promise<WorktreeInfo[]>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('runtime-aborted')), { once: true })
        })
      },
      isCurrentWorkspaceRuntime: () => true,
      onWorkspaceRuntimeClosed(listener) {
        closedListener = listener
        return () => undefined
      },
    })
    const first = resolver.capture(LOCAL_INPUT)
    const second = resolver.capture(LOCAL_INPUT)
    closedListener({
      userId: LOCAL_INPUT.userId,
      workspaceId: LOCAL_INPUT.workspaceId,
      workspaceRuntimeId: LOCAL_INPUT.workspaceRuntimeId,
    })

    await expect(first).rejects.toThrow('runtime-aborted')
    await expect(second).rejects.toThrow('runtime-aborted')
    resolver.dispose()
  })

  test('rejects a local path outside the validated worktree list', async () => {
    const resolver = new PhysicalWorktreeIdentityResolver({
      async getLocalWorktrees() {
        return [{ path: '/worktrees/known' } as WorktreeInfo]
      },
      async nativeRealpath(input) {
        return input
      },
      isCurrentWorkspaceRuntime: () => true,
      onWorkspaceRuntimeClosed: () => () => undefined,
    })

    await expect(resolver.capture({ ...LOCAL_INPUT, worktreePath: '/worktrees/unknown' })).rejects.toThrow(
      'error.invalid-worktree-path',
    )
    resolver.dispose()
  })
})

function remoteIdentityOutput(
  runtimeToken: string,
  machineFact: string,
  rootFact: string,
  endpoint = '/srv/worktrees/feature',
): string {
  return `${runtimeToken}\0${machineFact}\0${rootFact}\0${endpoint}\0`
}
