import { describe, expect, test, vi } from 'vitest'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import { normalizeRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import type { WorkspaceRuntimeClosedEvent } from '#/server/modules/workspace-runtimes.ts'
import { PhysicalWorktreeIdentityResolver } from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import { validatePhysicalWorktreeExecution } from '#/server/worktree-removal/physical-worktree-capability.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const LOCAL_INPUT = {
  userId: 'user-1',
  repoRoot: workspaceIdForTest('goblin+file:///repos/main'),
  workspaceRuntimeId: 'repo-runtime-1',
  worktreePath: '/worktrees/alias',
}
const LOCAL_MARKER = { deviceId: '10', inode: '20' }

describe('PhysicalWorktreeIdentityResolver', () => {
  test('captures the local workspace root without requiring Git worktree membership', async () => {
    const getLocalWorktrees = vi.fn()
    const resolver = new PhysicalWorktreeIdentityResolver({
      getLocalWorktrees,
      async nativeRealpath(input) {
        return input
      },
      async nativeStat() {
        return LOCAL_MARKER
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

  test('freshly validates and canonicalizes every local operation while binding one runtime identity', async () => {
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
      async nativeStat() {
        return LOCAL_MARKER
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
    expect(getLocalWorktrees).toHaveBeenCalledWith('/repos/main', {
      includeStatus: false,
      signal: expect.any(AbortSignal),
    })
    resolver.dispose()
  })

  test('marks a runtime stale when a fresh local canonical endpoint changes', async () => {
    let canonicalPath = '/volumes/repo/worktrees/feature'
    const resolver = new PhysicalWorktreeIdentityResolver({
      async getLocalWorktrees() {
        return [{ path: LOCAL_INPUT.worktreePath } as WorktreeInfo]
      },
      async nativeRealpath() {
        return canonicalPath
      },
      async nativeStat() {
        return LOCAL_MARKER
      },
      isCurrentWorkspaceRuntime: () => true,
      onWorkspaceRuntimeClosed: () => () => undefined,
    })

    await resolver.capture(LOCAL_INPUT)
    canonicalPath = '/volumes/repo/worktrees/replaced-feature'
    await expect(resolver.capture(LOCAL_INPUT)).rejects.toThrow('error.workspace-runtime-stale')
    resolver.dispose()
  })

  test('rejects a captured local capability when the canonical path is recreated with a new inode', async () => {
    let marker = LOCAL_MARKER
    const resolver = new PhysicalWorktreeIdentityResolver({
      async getLocalWorktrees() {
        return [{ path: LOCAL_INPUT.worktreePath } as WorktreeInfo]
      },
      async nativeRealpath() {
        return '/volumes/repo/worktrees/feature'
      },
      async nativeStat() {
        return marker
      },
      isCurrentWorkspaceRuntime: () => true,
      onWorkspaceRuntimeClosed: () => () => undefined,
    })
    const capability = await resolver.capture(LOCAL_INPUT)

    marker = { deviceId: LOCAL_MARKER.deviceId, inode: '21' }

    await expect(validatePhysicalWorktreeExecution(capability, undefined)).rejects.toThrow(
      'error.workspace-runtime-stale',
    )
    resolver.dispose()
  })

  test('marks a remote runtime stale when the execution endpoint changes under one SSH config', async () => {
    const repoRoot = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    let remoteOutput = remoteIdentityOutput('0123456789abcdef0123456789abcdef', 'machine-a', 'mnt-a')
    const runRemoteCommand = vi.fn(async () => ({ ok: true, stdout: remoteOutput, stderr: '' }))
    const resolver = new PhysicalWorktreeIdentityResolver({
      async resolveRemoteTarget() {
        return {
          target: {
            id: repoRoot,
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
    const input = { ...LOCAL_INPUT, repoRoot, worktreePath: '/srv/worktrees/feature' }

    await resolver.capture(input)
    remoteOutput = remoteIdentityOutput('fedcba9876543210fedcba9876543210', 'machine-b', 'mnt-b')
    await expect(resolver.capture(input)).rejects.toThrow('error.workspace-runtime-stale')
    expect(runRemoteCommand).toHaveBeenCalledTimes(2)
    resolver.dispose()
  })

  test('classifies transport failures while resolving the remote worktree list', async () => {
    const repoRoot = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const resolver = new PhysicalWorktreeIdentityResolver({
      async resolveRemoteTarget() {
        return {
          target: {
            id: repoRoot,
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
      resolver.capture({ ...LOCAL_INPUT, repoRoot, worktreePath: '/srv/worktrees/feature' }),
    ).rejects.toMatchObject({
      name: 'RemoteWorkspaceRuntimeFailureError',
      workspaceId: repoRoot,
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
      async nativeStat() {
        return LOCAL_MARKER
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
      workspaceId: LOCAL_INPUT.repoRoot,
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
      async nativeStat() {
        return LOCAL_MARKER
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
      async getLocalWorktrees(_repoRoot, options) {
        return await new Promise<WorktreeInfo[]>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('runtime-aborted')), { once: true })
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
      workspaceId: LOCAL_INPUT.repoRoot,
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
      async nativeStat() {
        return LOCAL_MARKER
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

function remoteIdentityOutput(runtimeToken: string, machineFact: string, rootFact: string): string {
  return `${runtimeToken}\0${machineFact}\0${rootFact}\0/srv/worktrees/feature\0${LOCAL_MARKER.deviceId}\0${LOCAL_MARKER.inode}\0`
}
