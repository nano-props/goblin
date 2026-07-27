import { describe, expect, test, vi } from 'vitest'
import {
  bootstrapRemoteWorktreeAfterCreate,
  createRemoteWorktree,
  deleteRemoteBranch,
  getRemoteBrowserUrl,
  getRemoteLog,
  getRemoteSnapshot,
  getRemoteRepoWorktreePaths,
  getRemoteWorkspacePaneTargetIdentities,
  getRemoteTrackingBranches,
  getRemoteTreeWalk,
  getRemoteWorktreeBootstrapPreview,
  pullRemoteBranch,
  fetchRemoteRepo,
  remoteCommandExists,
  remoteCommandExistsAtWorkspaceRoot,
  pushRemoteBranch,
  remoteExecResult,
  removeRemoteWorktree,
  type RemoteGitRunner,
  resolveRemoteWorktree,
} from '#/system/ssh/git.ts'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import type { RemoteCommandResult } from '#/system/ssh/commands.ts'
import { worktreeBootstrapConfigHash } from '#/system/git/worktree-bootstrap.ts'
import { normalizeRemoteTarget } from '#/shared/remote-workspace.ts'

// Remote Git tests share canonical targets and byte-exact command output fixtures.
export const TARGET = normalizeRemoteTarget({
  alias: 'prod',
  host: 'example.com',
  user: 'alice',
  port: 22,
  remotePath: '/srv/repo',
})!
export const LINKED_TARGET = normalizeRemoteTarget({
  alias: 'prod',
  host: 'example.com',
  user: 'alice',
  port: 22,
  remotePath: '/srv/repo-feature',
})!

export const NUL = String.fromCharCode(0)

export function worktreePorcelain(lines: string): string {
  return `${lines
    .trim()
    .split('\n')
    .map((line) => line.replace(/^HEAD ([0-9a-f]{7})$/u, 'HEAD $100000000000000000000000000000000'))
    .join(NUL)}${NUL}${NUL}`
}

export function upstreamOutput(remote: string, branch: string, trackState = '='): string {
  const ref = remote === '.' ? `refs/heads/${branch}` : `refs/remotes/${remote}/${branch}`
  return [ref, remote, `refs/heads/${branch}`, trackState].join(NUL)
}

export const PRIMARY_WORKTREE_OUTPUT = worktreePorcelain('worktree /srv/repo\nHEAD f00ba40\nbranch refs/heads/main')
export const MAIN_AND_LINKED_WORKTREES_OUTPUT = worktreePorcelain(
  [
    'worktree /srv/repo',
    'HEAD f00ba40',
    'branch refs/heads/main',
    '',
    'worktree /srv/repo-feature',
    'HEAD ba5eba1',
    'branch refs/heads/feature/test',
  ].join('\n'),
)
export const MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT = [
  '__GOBLIN_REMOTE_CURRENT__',
  'value main',
  '__GOBLIN_REMOTE_DEFAULT__',
  'value main',
  '__GOBLIN_REMOTE_BRANCHES__',
  '',
].join('\n')
export const SUCCESSFUL_REMOTE_REMOVAL_LIFECYCLE = {
  beforeRemove: async () => ({ ok: true as const, message: '' }),
  afterWorktreeRemoved: async () => ({ ok: true as const, message: '' }),
}

export function okRemoteResult(stdout: string): RemoteCommandResult {
  return { ok: true, stdout, stderr: '' }
}

export function failRemoteResult(message: string): RemoteCommandResult {
  return { ok: false, stdout: '', stderr: message, message }
}
