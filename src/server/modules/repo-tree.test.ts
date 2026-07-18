import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveRemoteWorkspaceTarget: vi.fn(),
  remoteRuntimeAwareGitRunner: vi.fn(),
  getRepoTreeSourceLocal: vi.fn(),
  getWorkspaceTreeSourceLocal: vi.fn(),
  getRepoTreeSourceRemote: vi.fn(),
  getWorkspaceTreeSourceRemote: vi.fn(),
  getWorktrees: vi.fn(),
}))

vi.mock('#/server/modules/repo-source.ts', () => ({
  resolveRemoteWorkspaceTarget: mocks.resolveRemoteWorkspaceTarget,
  remoteRuntimeAwareGitRunner: mocks.remoteRuntimeAwareGitRunner,
}))

vi.mock('#/server/modules/repo-tree-source.ts', () => ({
  getRepoTreeSourceLocal: mocks.getRepoTreeSourceLocal,
  getWorkspaceTreeSourceLocal: mocks.getWorkspaceTreeSourceLocal,
  getRepoTreeSourceRemote: mocks.getRepoTreeSourceRemote,
  getWorkspaceTreeSourceRemote: mocks.getWorkspaceTreeSourceRemote,
}))

vi.mock('#/system/git/worktrees.ts', () => ({
  getWorktrees: mocks.getWorktrees,
}))

import { getRepositoryTree } from '#/server/modules/repo-tree.ts'
import { normalizeRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { canonicalRuntimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-validators.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

const LOCAL_REPO_ID = workspaceIdForTest('goblin+file:///tmp/repo')
const remoteRepoId = normalizeRemoteWorkspaceId({ alias: 'mybox', remotePath: '/srv/repos/myrepo' })
const remoteWorkspaceId = workspaceIdForTest(remoteRepoId)
const remoteTarget: RemoteWorkspaceTarget = {
  id: remoteRepoId,
  alias: 'mybox',
  remotePath: '/srv/repos/myrepo',
  displayName: 'mybox:myrepo',
  host: 'mybox.local',
  user: 'git',
  port: 22,
}
const RUNTIME_ID = 'repo-runtime-tree-test'

function workspaceRootTarget(workspaceId: WorkspaceId) {
  const target = canonicalRuntimeWorkspacePaneTarget({
    kind: 'workspace-root',
    workspaceId,
    workspaceRuntimeId: RUNTIME_ID,
  })
  if (!target || target.kind === 'git-branch') throw new Error('invalid mock workspace root target')
  return target
}

function gitWorktreeTarget(workspaceId: WorkspaceId, root: string) {
  const target = canonicalRuntimeWorkspacePaneTarget({
    kind: 'git-worktree',
    workspaceId,
    workspaceRuntimeId: RUNTIME_ID,
    root,
  })
  if (!target || target.kind === 'git-branch') throw new Error('error.workspace-target-transport-mismatch')
  return target
}

function localWorktreeTarget() {
  return gitWorktreeTarget(LOCAL_REPO_ID, 'goblin+file:///tmp/repo/.worktrees/feature')
}

function remoteWorktreeTarget() {
  return gitWorktreeTarget(
    remoteWorkspaceId,
    normalizeRemoteWorkspaceId({ alias: 'mybox', remotePath: '/srv/repos/myrepo/.worktrees/feature' }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.remoteRuntimeAwareGitRunner.mockReturnValue(async () => ({ ok: true, stdout: '', stderr: '', code: 0 }))
  mocks.getWorktrees.mockResolvedValue([
    { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
    { path: '/tmp/repo/.worktrees/feature', branch: 'feature', isBare: false, isPrimary: false },
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('repo-tree — read layer', () => {
  test('reads the exact workspace root without requiring Git worktree membership', async () => {
    mocks.getWorkspaceTreeSourceLocal.mockResolvedValueOnce({ nodes: [], truncated: false })

    await expect(getRepositoryTree(workspaceRootTarget(LOCAL_REPO_ID))).resolves.toEqual({
      nodes: [],
      truncated: false,
    })

    expect(mocks.getWorktrees).not.toHaveBeenCalled()
    expect(mocks.getWorkspaceTreeSourceLocal).toHaveBeenCalledWith('/tmp/repo', expect.any(Object), undefined)
  })

  test('validates a local worktree and forwards to the local source', async () => {
    mocks.getRepoTreeSourceLocal.mockResolvedValueOnce({
      nodes: [{ id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' }],
      truncated: false,
    })

    const result = await getRepositoryTree(localWorktreeTarget(), { prefix: 'src' })

    expect(mocks.getWorktrees).toHaveBeenCalledWith('/tmp/repo', {
      includeStatus: false,
    })
    expect(mocks.getRepoTreeSourceLocal).toHaveBeenCalledWith(
      '/tmp/repo/.worktrees/feature',
      expect.objectContaining({ prefix: 'src' }),
      undefined,
    )
    expect(result.nodes).toHaveLength(1)
  })

  test('threads request cancellation through Git membership and directory I/O', async () => {
    mocks.getRepoTreeSourceLocal.mockResolvedValueOnce({ nodes: [], truncated: false })
    const signal = new AbortController().signal

    await getRepositoryTree(localWorktreeTarget(), { signal })

    expect(mocks.getWorktrees).toHaveBeenCalledWith('/tmp/repo', { includeStatus: false, signal })
    expect(mocks.getRepoTreeSourceLocal).toHaveBeenCalledWith(
      '/tmp/repo/.worktrees/feature',
      expect.any(Object),
      signal,
    )
  })

  test('uses precomputed worktrees when the caller already has them', async () => {
    const precomputedWorktrees = [
      { path: '/tmp/repo/.worktrees/feature', branch: 'feature', isBare: false, isPrimary: false },
    ]
    mocks.getRepoTreeSourceLocal.mockResolvedValueOnce({ nodes: [], truncated: false })

    await getRepositoryTree(localWorktreeTarget(), { precomputedWorktrees })

    expect(mocks.getWorktrees).not.toHaveBeenCalled()
    expect(mocks.getRepoTreeSourceLocal).toHaveBeenCalled()
  })

  test('rejects an unknown local worktree path before invoking the source', async () => {
    await expect(getRepositoryTree(gitWorktreeTarget(LOCAL_REPO_ID, 'goblin+file:///etc/passwd'))).rejects.toThrow(
      'unknown worktree path',
    )

    expect(mocks.getRepoTreeSourceLocal).not.toHaveBeenCalled()
  })

  test('rejects a worktree locator from another local platform before I/O', async () => {
    expect(() => gitWorktreeTarget(LOCAL_REPO_ID, 'goblin+file:///C:/mock-worktree')).toThrow(
      'error.workspace-target-transport-mismatch',
    )

    expect(mocks.getWorktrees).not.toHaveBeenCalled()
    expect(mocks.getRepoTreeSourceLocal).not.toHaveBeenCalled()
  })

  test('rejects when the local source throws', async () => {
    mocks.getRepoTreeSourceLocal.mockRejectedValueOnce(new Error('boom'))

    await expect(getRepositoryTree(localWorktreeTarget())).rejects.toThrow('boom')
  })

  test('resolves a remote target and forwards to the remote source', async () => {
    mocks.resolveRemoteWorkspaceTarget.mockResolvedValueOnce(remoteTarget)
    mocks.getRepoTreeSourceRemote.mockResolvedValueOnce({
      nodes: [{ id: 'README.md', path: 'README.md', name: 'README.md', parentId: null, kind: 'file', status: 'clean' }],
      truncated: false,
    })

    const result = await getRepositoryTree(remoteWorktreeTarget(), { prefix: 'src' })

    expect(mocks.getWorktrees).not.toHaveBeenCalled()
    expect(mocks.resolveRemoteWorkspaceTarget).toHaveBeenCalledWith(remoteRepoId, undefined, undefined)
    expect(mocks.getRepoTreeSourceRemote).toHaveBeenCalledWith(
      expect.objectContaining({
        target: remoteTarget,
        worktreePath: '/srv/repos/myrepo/.worktrees/feature',
        options: expect.objectContaining({ prefix: 'src' }),
      }),
    )
    expect(result.nodes).toHaveLength(1)
  })

  test('reads a remote workspace root without Git worktree membership', async () => {
    mocks.resolveRemoteWorkspaceTarget.mockResolvedValueOnce(remoteTarget)
    mocks.getWorkspaceTreeSourceRemote.mockResolvedValueOnce({ nodes: [], truncated: false })

    await getRepositoryTree(workspaceRootTarget(remoteWorkspaceId))

    expect(mocks.getWorkspaceTreeSourceRemote).toHaveBeenCalledWith(
      expect.objectContaining({
        target: remoteTarget,
        worktreePath: '/srv/repos/myrepo',
      }),
    )
  })

  test('threads precomputed remote worktrees into the remote source', async () => {
    const precomputedWorktrees = [
      { path: '/srv/repos/myrepo/.worktrees/feature', branch: 'feature', isBare: false, isPrimary: false },
    ]
    mocks.resolveRemoteWorkspaceTarget.mockResolvedValueOnce(remoteTarget)
    mocks.getRepoTreeSourceRemote.mockResolvedValueOnce({ nodes: [], truncated: false })

    await getRepositoryTree(remoteWorktreeTarget(), { precomputedWorktrees })

    expect(mocks.getRepoTreeSourceRemote).toHaveBeenCalledWith(
      expect.objectContaining({ knownWorktrees: precomputedWorktrees }),
    )
  })

  test('threads the runtime-aware runner into remote tree reads', async () => {
    const run = async () => ({ ok: true as const, stdout: '', stderr: '', code: 0 })
    mocks.remoteRuntimeAwareGitRunner.mockReturnValueOnce(run)
    mocks.resolveRemoteWorkspaceTarget.mockResolvedValueOnce(remoteTarget)
    mocks.getRepoTreeSourceRemote.mockResolvedValueOnce({ nodes: [], truncated: false })

    const signal = new AbortController().signal
    await getRepositoryTree(remoteWorktreeTarget(), {
      workspaceRuntimeId: 'repo-runtime-tree-test',
      signal,
    })

    expect(mocks.resolveRemoteWorkspaceTarget).toHaveBeenCalledWith(
      remoteRepoId,
      {
        workspaceRuntimeId: 'repo-runtime-tree-test',
      },
      signal,
    )
    expect(mocks.remoteRuntimeAwareGitRunner).toHaveBeenCalledWith(remoteRepoId, 'repo-runtime-tree-test', remoteTarget)
    expect(mocks.getRepoTreeSourceRemote).toHaveBeenCalledWith(expect.objectContaining({ run }))
  })

  test('rejects when remote target resolution fails', async () => {
    mocks.resolveRemoteWorkspaceTarget.mockRejectedValueOnce(new Error('ssh config not found'))

    await expect(getRepositoryTree(remoteWorktreeTarget())).rejects.toThrow('ssh config not found')
    expect(mocks.getRepoTreeSourceRemote).not.toHaveBeenCalled()
  })

  test('rejects a worktree locator from another SSH profile before I/O', async () => {
    const otherProfileRoot = normalizeRemoteWorkspaceId({
      alias: 'other-mock-host',
      remotePath: '/srv/repos/myrepo/.worktrees/feature',
    })

    expect(() => gitWorktreeTarget(remoteWorkspaceId, otherProfileRoot)).toThrow(
      'error.workspace-target-transport-mismatch',
    )
    expect(mocks.resolveRemoteWorkspaceTarget).not.toHaveBeenCalled()
    expect(mocks.getRepoTreeSourceRemote).not.toHaveBeenCalled()
  })

  test('rejects malformed worktree paths before any source call', async () => {
    expect(() => gitWorktreeTarget(LOCAL_REPO_ID, '')).toThrow()
    expect(() => gitWorktreeTarget(LOCAL_REPO_ID, 'goblin+file:///tmp/bad\0path')).toThrow()
    expect(mocks.getRepoTreeSourceLocal).not.toHaveBeenCalled()
    expect(mocks.getRepoTreeSourceRemote).not.toHaveBeenCalled()
  })
})
