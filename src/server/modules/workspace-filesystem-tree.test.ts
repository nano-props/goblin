import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveRemoteWorkspaceTarget: vi.fn(),
  remoteRuntimeAwareGitRunner: vi.fn(),
  readGitWorktreeFilesystemSourceLocal: vi.fn(),
  readWorkspaceFilesystemSourceLocal: vi.fn(),
  readGitWorktreeFilesystemSourceRemote: vi.fn(),
  readWorkspaceFilesystemSourceRemote: vi.fn(),
  getWorktrees: vi.fn(),
  resolveRemoteWorktree: vi.fn(),
}))

vi.mock('#/server/modules/repo-source.ts', () => ({
  resolveRemoteWorkspaceTarget: mocks.resolveRemoteWorkspaceTarget,
  remoteRuntimeAwareGitRunner: mocks.remoteRuntimeAwareGitRunner,
}))

vi.mock('#/server/modules/workspace-filesystem-source.ts', () => ({
  readGitWorktreeFilesystemSourceLocal: mocks.readGitWorktreeFilesystemSourceLocal,
  readWorkspaceFilesystemSourceLocal: mocks.readWorkspaceFilesystemSourceLocal,
  readGitWorktreeFilesystemSourceRemote: mocks.readGitWorktreeFilesystemSourceRemote,
  readWorkspaceFilesystemSourceRemote: mocks.readWorkspaceFilesystemSourceRemote,
}))

vi.mock('#/system/git/worktrees.ts', () => ({
  getWorktrees: mocks.getWorktrees,
}))

vi.mock('#/system/ssh/git.ts', () => ({
  resolveRemoteWorktree: mocks.resolveRemoteWorktree,
}))

import { readWorkspaceFilesystemTree } from '#/server/modules/workspace-filesystem-tree.ts'
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
  mocks.resolveRemoteWorktree.mockResolvedValue({
    path: '/srv/repos/myrepo/.worktrees/feature',
    branch: 'feature',
    isBare: false,
    isPrimary: false,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('workspace filesystem tree read layer', () => {
  test('reads the exact workspace root without requiring Git worktree membership', async () => {
    mocks.readWorkspaceFilesystemSourceLocal.mockResolvedValueOnce({ nodes: [], truncated: false })

    await expect(readWorkspaceFilesystemTree(workspaceRootTarget(LOCAL_REPO_ID))).resolves.toEqual({
      nodes: [],
      truncated: false,
    })

    expect(mocks.getWorktrees).not.toHaveBeenCalled()
    expect(mocks.readWorkspaceFilesystemSourceLocal).toHaveBeenCalledWith('/tmp/repo', expect.any(Object), undefined)
  })

  test('validates a local worktree and forwards to the local source', async () => {
    mocks.readGitWorktreeFilesystemSourceLocal.mockResolvedValueOnce({
      nodes: [{ id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' }],
      truncated: false,
    })

    const result = await readWorkspaceFilesystemTree(localWorktreeTarget(), { prefix: 'src' })

    expect(mocks.getWorktrees).toHaveBeenCalledWith('/tmp/repo', {
      includeStatus: false,
    })
    expect(mocks.readGitWorktreeFilesystemSourceLocal).toHaveBeenCalledWith(
      '/tmp/repo/.worktrees/feature',
      expect.objectContaining({ prefix: 'src' }),
      undefined,
    )
    expect(result.nodes).toHaveLength(1)
  })

  test('threads request cancellation through Git membership and directory I/O', async () => {
    mocks.readGitWorktreeFilesystemSourceLocal.mockResolvedValueOnce({ nodes: [], truncated: false })
    const signal = new AbortController().signal

    await readWorkspaceFilesystemTree(localWorktreeTarget(), { signal })

    expect(mocks.getWorktrees).toHaveBeenCalledWith('/tmp/repo', { includeStatus: false, signal })
    expect(mocks.readGitWorktreeFilesystemSourceLocal).toHaveBeenCalledWith(
      '/tmp/repo/.worktrees/feature',
      expect.any(Object),
      signal,
    )
  })

  test('rejects an unknown local worktree path before invoking the source', async () => {
    await expect(
      readWorkspaceFilesystemTree(gitWorktreeTarget(LOCAL_REPO_ID, 'goblin+file:///etc/passwd')),
    ).rejects.toThrow('unknown worktree path')

    expect(mocks.readGitWorktreeFilesystemSourceLocal).not.toHaveBeenCalled()
  })

  test('rejects a worktree locator from another local platform before I/O', async () => {
    expect(() => gitWorktreeTarget(LOCAL_REPO_ID, 'goblin+file:///C:/mock-worktree')).toThrow(
      'error.workspace-target-transport-mismatch',
    )

    expect(mocks.getWorktrees).not.toHaveBeenCalled()
    expect(mocks.readGitWorktreeFilesystemSourceLocal).not.toHaveBeenCalled()
  })

  test('rejects when the local source throws', async () => {
    mocks.readGitWorktreeFilesystemSourceLocal.mockRejectedValueOnce(new Error('boom'))

    await expect(readWorkspaceFilesystemTree(localWorktreeTarget())).rejects.toThrow('boom')
  })

  test('resolves a remote target and forwards to the remote source', async () => {
    mocks.resolveRemoteWorkspaceTarget.mockResolvedValueOnce(remoteTarget)
    mocks.readGitWorktreeFilesystemSourceRemote.mockResolvedValueOnce({
      nodes: [{ id: 'README.md', path: 'README.md', name: 'README.md', parentId: null, kind: 'file', status: 'clean' }],
      truncated: false,
    })

    const result = await readWorkspaceFilesystemTree(remoteWorktreeTarget(), { prefix: 'src' })

    expect(mocks.getWorktrees).not.toHaveBeenCalled()
    expect(mocks.resolveRemoteWorkspaceTarget).toHaveBeenCalledWith(
      remoteRepoId,
      { workspaceRuntimeId: RUNTIME_ID },
      undefined,
    )
    expect(mocks.readGitWorktreeFilesystemSourceRemote).toHaveBeenCalledWith(
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
    mocks.readWorkspaceFilesystemSourceRemote.mockResolvedValueOnce({ nodes: [], truncated: false })

    await readWorkspaceFilesystemTree(workspaceRootTarget(remoteWorkspaceId))

    expect(mocks.readWorkspaceFilesystemSourceRemote).toHaveBeenCalledWith(
      expect.objectContaining({
        target: remoteTarget,
        worktreePath: '/srv/repos/myrepo',
      }),
    )
  })

  test('threads the runtime-aware runner into remote tree reads', async () => {
    const run = async () => ({ ok: true as const, stdout: '', stderr: '', code: 0 })
    mocks.remoteRuntimeAwareGitRunner.mockReturnValueOnce(run)
    mocks.resolveRemoteWorkspaceTarget.mockResolvedValueOnce(remoteTarget)
    mocks.readGitWorktreeFilesystemSourceRemote.mockResolvedValueOnce({ nodes: [], truncated: false })

    const signal = new AbortController().signal
    await readWorkspaceFilesystemTree(remoteWorktreeTarget(), { signal })

    expect(mocks.resolveRemoteWorkspaceTarget).toHaveBeenCalledWith(
      remoteRepoId,
      {
        workspaceRuntimeId: 'repo-runtime-tree-test',
      },
      signal,
    )
    expect(mocks.remoteRuntimeAwareGitRunner).toHaveBeenCalledWith(remoteRepoId, 'repo-runtime-tree-test', remoteTarget)
    expect(mocks.readGitWorktreeFilesystemSourceRemote).toHaveBeenCalledWith(expect.objectContaining({ run }))
  })

  test('rejects when remote target resolution fails', async () => {
    mocks.resolveRemoteWorkspaceTarget.mockRejectedValueOnce(new Error('ssh config not found'))

    await expect(readWorkspaceFilesystemTree(remoteWorktreeTarget())).rejects.toThrow('ssh config not found')
    expect(mocks.readGitWorktreeFilesystemSourceRemote).not.toHaveBeenCalled()
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
    expect(mocks.readGitWorktreeFilesystemSourceRemote).not.toHaveBeenCalled()
  })

  test('rejects malformed worktree paths before any source call', async () => {
    expect(() => gitWorktreeTarget(LOCAL_REPO_ID, '')).toThrow()
    expect(() => gitWorktreeTarget(LOCAL_REPO_ID, 'goblin+file:///tmp/bad\0path')).toThrow()
    expect(mocks.readGitWorktreeFilesystemSourceLocal).not.toHaveBeenCalled()
    expect(mocks.readGitWorktreeFilesystemSourceRemote).not.toHaveBeenCalled()
  })
})
