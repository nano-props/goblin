import path from 'node:path'
import { runRemoteCommand } from '#/system/ssh/commands.ts'
import { isValidRemotePath, parseRemoteSnapshot } from '#/system/ssh/git/codec.ts'
import type { RemoteRepoSnapshot } from '#/system/ssh/git/codec.ts'
import { repoWorktreeMaterializedBranch } from '#/shared/git-types.ts'
import type { WorkspacePaneTargetIdentity, WorkspacePaneTargetMembership, WorktreeInfo } from '#/shared/git-types.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import type { RemoteCommandRunner } from '#/system/ssh/commands.ts'
import { getRemoteRepoInfo } from '#/system/ssh/git/remote.ts'
import { readRemoteRepoWorktreeSnapshots, readRemoteWorktreeMembership } from '#/system/ssh/git/worktrees.ts'

export async function getRemoteSnapshot(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteCommandRunner } = {},
): Promise<RemoteRepoSnapshot> {
  const run: RemoteCommandRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const membership = await readRemoteWorktreeMembership(target, { signal: options.signal, run })
  const sourceWorktree = await resolveRemoteSnapshotSourceWorktree(target, membership, {
    signal: options.signal,
    run,
  })
  const [result, remote, worktrees] = await Promise.all([
    run({ type: 'gitSnapshot', path: target.remotePath }, target, { signal: options.signal }),
    getRemoteRepoInfo(target, { signal: options.signal, run }),
    readRemoteRepoWorktreeSnapshots(target, membership, { signal: options.signal, run }),
  ])
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  const snapshot = parseRemoteSnapshot(result.stdout)
  if (!snapshot) throw new Error('error.failed-read-repo')
  const current = sourceWorktree.isBare ? snapshot.current : (sourceWorktree.branch ?? '')
  return { ...snapshot, current, worktrees, remote }
}

async function resolveRemoteSnapshotSourceWorktree(
  target: RemoteWorkspaceTarget,
  membership: readonly WorktreeInfo[],
  options: { signal?: AbortSignal; run: RemoteCommandRunner },
): Promise<WorktreeInfo> {
  const direct = membership.find((worktree) => worktree.path === target.remotePath)
  if (direct) return direct
  const result = await options.run({ type: 'resolveGitWorkspacePath', path: target.remotePath }, target, {
    signal: options.signal,
  })
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  const sourcePath = result.stdout.endsWith('\n') ? result.stdout.slice(0, -1) : result.stdout
  if (!isValidRemotePath(sourcePath) || /[\r\n]/u.test(sourcePath)) throw new Error('error.failed-read-repo')
  const sourceWorktree = membership.find((worktree) => worktree.path === sourcePath)
  if (!sourceWorktree) throw new Error('error.failed-read-repo')
  return sourceWorktree
}

export async function getRemoteWorkspacePaneTargetMembership(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteCommandRunner } = {},
): Promise<WorkspacePaneTargetMembership> {
  const run: RemoteCommandRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const membership = await readRemoteWorktreeMembership(target, { signal: options.signal, run })
  const [sourceWorktree, worktrees] = await Promise.all([
    resolveRemoteSnapshotSourceWorktree(target, membership, { signal: options.signal, run }),
    readRemoteRepoWorktreeSnapshots(target, membership, { signal: options.signal, run }),
  ])
  const result = await run({ type: 'gitLocalBranches', path: target.remotePath }, target, {
    signal: options.signal,
  })
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  const branches = result.stdout ? result.stdout.split('\n') : []
  if (branches.some((branch) => !isSafeBranchName(branch)) || new Set(branches).size !== branches.length) {
    throw new Error('error.failed-read-repo')
  }
  const branchNames = new Set(branches)
  if (
    worktrees.some(
      (worktree) =>
        worktree.headOid !== null &&
        worktree.materializedBranch !== null &&
        !branchNames.has(worktree.materializedBranch),
    )
  ) {
    throw new Error('error.failed-read-repo')
  }
  const materializedBranches = new Set(
    worktrees.flatMap((worktree) => {
      const branchName = repoWorktreeMaterializedBranch(worktree)
      return branchName ? [branchName] : []
    }),
  )
  const identities = [
    ...worktrees.map((worktree): WorkspacePaneTargetIdentity => ({
      kind: 'git-worktree',
      worktreePath: worktree.path,
      head: worktree.head,
      materializedBranch: worktree.materializedBranch,
    })),
    ...branches
      .filter((branch) => !materializedBranches.has(branch))
      .map((branch): WorkspacePaneTargetIdentity => ({ kind: 'git-branch', branchName: branch })),
  ]
  return {
    source: sourceWorktree.isBare
      ? { kind: 'bare-repository', repositoryPath: sourceWorktree.path }
      : { kind: 'worktree', worktreePath: sourceWorktree.path },
    identities,
  }
}
