import { describe, expect, test } from 'vitest'
import type { BranchSnapshotInfo, RepoWorktreeSnapshot, WorktreeStatus } from '#/shared/git-types.ts'
import type { RepoSnapshot } from '#/shared/api-types.ts'
import { buildDashboardSummary } from '#/web/components/workspace-pages/workspace-dashboard-model.ts'

describe('workspace dashboard model', () => {
  test('counts every authoritative worktree including a generic detached worktree', () => {
    const attached = worktree('/repo', { kind: 'branch', branchName: 'main' }, 'main')
    const detached = worktree('/repo/detached', { kind: 'detached' }, null)

    const summary = buildDashboardSummary(
      {
        snapshot: snapshot([attached, detached]),
        status: [worktreeStatus(attached.path, []), worktreeStatus(detached.path, ['conflicted.txt'])],
      },
      [],
    )

    expect(summary.worktreeCount).toBe(2)
    expect(summary.dirtyWorktreeCount).toBe(1)
  })

  test('keeps the dirty worktree count unknown until status covers every current worktree', () => {
    const attached = worktree('/repo', { kind: 'branch', branchName: 'main' }, 'main')
    const detached = worktree('/repo/detached', { kind: 'detached' }, null)

    const summary = buildDashboardSummary(
      {
        snapshot: snapshot([attached, detached]),
        status: [worktreeStatus(attached.path, [])],
      },
      [],
    )

    expect(summary.worktreeCount).toBe(2)
    expect(summary.dirtyWorktreeCount).toBeUndefined()
  })
})

function snapshot(worktrees: RepoWorktreeSnapshot[]): RepoSnapshot {
  return {
    branches: [branch('main')],
    worktrees,
    current: 'main',
    remote: {
      remotes: [],
      hasRemotes: false,
      hasBrowserRemote: false,
      remoteProviders: {},
      hasGitHubRemote: false,
    },
  }
}

function branch(name: string): BranchSnapshotInfo {
  return {
    name,
    ahead: 0,
    behind: 0,
    lastCommitHash: '0123456789abcdef0123456789abcdef01234567',
    lastCommitShortHash: '0123456',
    lastCommitMessage: 'Test commit',
    lastCommitDate: '2025-01-01T00:00:00Z',
    lastCommitAuthor: 'Test User',
  }
}

function worktree(
  path: string,
  head: RepoWorktreeSnapshot['head'],
  materializedBranch: string | null,
): RepoWorktreeSnapshot {
  return {
    path,
    head,
    headOid: '0123456789abcdef0123456789abcdef01234567',
    operation: null,
    materializedBranch,
    isPrimary: path === '/repo',
    isLocked: false,
  }
}

function worktreeStatus(path: string, paths: string[]): WorktreeStatus {
  return {
    path,
    isMain: path === '/repo',
    entries: paths.map((entryPath) => ({ x: 'M', y: ' ', path: entryPath })),
  }
}
