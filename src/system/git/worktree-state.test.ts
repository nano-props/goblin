import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { git } from '#/system/git/git-exec.ts'
import { readGitWorktreeState, readRepoWorktreeSnapshots } from '#/system/git/worktree-state.ts'
import { readWorktreeMembership } from '#/system/git/worktrees.ts'

let repoPath = ''
let gitDir = ''
let offlineWorktreePath = ''

beforeEach(async () => {
  repoPath = await mkdtemp(path.join(os.tmpdir(), 'goblin-worktree-state-'))
  await git(repoPath, ['init', '--initial-branch=main'])
  gitDir = await git(repoPath, ['rev-parse', '--absolute-git-dir'])
})

afterEach(async () => {
  if (repoPath) await rm(repoPath, { recursive: true, force: true })
  if (offlineWorktreePath) await rm(offlineWorktreePath, { recursive: true, force: true })
})

describe('readGitWorktreeState', () => {
  test('returns null outside an in-progress operation', async () => {
    await expect(readGitWorktreeState(repoPath, gitDir)).resolves.toEqual({ operation: null, materializedBranch: null })
  })

  test('reads the rebased branch from either rebase administration format', async () => {
    const rebaseMergePath = await gitPath('rebase-merge')
    await mkdir(rebaseMergePath)
    await writeFile(path.join(rebaseMergePath, 'head-name'), 'refs/heads/feature/example\n')
    await expect(readGitWorktreeState(repoPath, gitDir)).resolves.toEqual({
      operation: { kind: 'rebase' },
      materializedBranch: 'feature/example',
    })

    await rm(rebaseMergePath, { recursive: true })
    await mkdir(await gitPath('rebase-apply'))
    await expect(readGitWorktreeState(repoPath, gitDir)).resolves.toEqual({
      operation: { kind: 'rebase' },
      materializedBranch: null,
    })
  })

  test.each([null, 'plain/branch', 'detached HEAD'])(
    'falls back to bisect branch authority when rebase head-name is %s',
    async (headName) => {
      const rebaseMergePath = await gitPath('rebase-merge')
      await mkdir(rebaseMergePath)
      if (headName !== null) await writeFile(path.join(rebaseMergePath, 'head-name'), `${headName}\n`)
      await writeFile(await gitPath('BISECT_LOG'), 'git bisect start\n')
      await writeFile(await gitPath('BISECT_START'), 'feature/example\n')

      await expect(readGitWorktreeState(repoPath, gitDir)).resolves.toEqual({
        operation: { kind: 'rebase' },
        materializedBranch: 'feature/example',
      })
    },
  )

  test.each(['rebase-merge', 'rebase-apply'])('ignores a non-directory %s marker', async (marker) => {
    await writeFile(await gitPath(marker), 'not a rebase directory\n')

    await expect(readGitWorktreeState(repoPath, gitDir)).resolves.toEqual({ operation: null, materializedBranch: null })
  })

  test.each([
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert'],
    ['MERGE_HEAD', 'merge'],
  ] as const)('detects %s', async (marker, kind) => {
    await writeFile(await gitPath(marker), '0123456789abcdef\n')
    await expect(readGitWorktreeState(repoPath, gitDir)).resolves.toEqual({
      operation: { kind },
      materializedBranch: null,
    })
  })

  test('reads the branch retained by an in-progress bisect', async () => {
    await writeFile(await gitPath('BISECT_LOG'), 'git bisect start\n')
    await writeFile(await gitPath('BISECT_START'), 'feature/example\n')

    await expect(readGitWorktreeState(repoPath, gitDir)).resolves.toEqual({
      operation: { kind: 'bisect' },
      materializedBranch: 'feature/example',
    })
  })

  test.each([
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['MERGE_HEAD', 'merge'],
  ] as const)('retains the bisected branch while presenting a concurrent %s', async (marker, kind) => {
    await writeFile(await gitPath('BISECT_LOG'), 'git bisect start\n')
    await writeFile(await gitPath('BISECT_START'), 'feature/example\n')
    await writeFile(await gitPath(marker), '0123456789abcdef\n')

    await expect(readGitWorktreeState(repoPath, gitDir)).resolves.toEqual({
      operation: { kind },
      materializedBranch: 'feature/example',
    })
  })
})

test('excludes bare repositories from routable worktree membership', async () => {
  await expect(
    readRepoWorktreeSnapshots(repoPath, [{ path: repoPath, isBare: true, isPrimary: true }]),
  ).resolves.toEqual([])
})

test('rejects an attached membership that changes to rebase while operation state is read', async () => {
  const rebaseMergePath = await gitPath('rebase-merge')
  await mkdir(rebaseMergePath)
  await writeFile(path.join(rebaseMergePath, 'head-name'), 'refs/heads/main\n')

  await expect(readAttachedRepoWorktreeSnapshots()).rejects.toThrow(
    'Git worktree membership changed while reading operation state',
  )
})

test('accepts an attached worktree while bisect is waiting for boundary commits', async () => {
  await writeFile(await gitPath('BISECT_LOG'), 'git bisect start\n')
  await writeFile(await gitPath('BISECT_START'), 'main\n')

  await expect(readAttachedRepoWorktreeSnapshots()).resolves.toEqual([
    expect.objectContaining({
      head: { kind: 'branch', branchName: 'main' },
      operation: { kind: 'bisect' },
      materializedBranch: 'main',
    }),
  ])
})

test('reads a locked linked worktree from its administrative directory while its path is offline', async () => {
  await git(repoPath, ['config', 'user.email', 'example@example.invalid'])
  await git(repoPath, ['config', 'user.name', 'Example'])
  await writeFile(path.join(repoPath, 'file.txt'), 'initial\n')
  await git(repoPath, ['add', 'file.txt'])
  await git(repoPath, ['commit', '-m', 'initial'])
  const linkedPath = `${repoPath}-portable`
  offlineWorktreePath = `${linkedPath}-offline`
  await git(repoPath, ['worktree', 'add', '-b', 'portable', linkedPath])
  await git(repoPath, ['worktree', 'lock', '--reason', 'portable', linkedPath])
  const linkedGitDir = await git(linkedPath, ['rev-parse', '--absolute-git-dir'])
  await writeFile(path.join(linkedGitDir, 'MERGE_HEAD'), '0'.repeat(40))
  await rename(linkedPath, offlineWorktreePath)

  const membership = await readWorktreeMembership(repoPath)
  const snapshots = await readRepoWorktreeSnapshots(repoPath, membership)
  const linkedMembership = membership.find((worktree) => worktree.branch === 'portable')

  expect(snapshots).toContainEqual(
    expect.objectContaining({
      path: linkedMembership?.path,
      head: { kind: 'branch', branchName: 'portable' },
      materializedBranch: 'portable',
      operation: { kind: 'merge' },
      isLocked: true,
    }),
  )
})

test('ignores an unrelated incomplete administrative directory outside current membership', async () => {
  await git(repoPath, ['config', 'user.email', 'example@example.invalid'])
  await git(repoPath, ['config', 'user.name', 'Example'])
  await writeFile(path.join(repoPath, 'file.txt'), 'initial\n')
  await git(repoPath, ['add', 'file.txt'])
  await git(repoPath, ['commit', '-m', 'initial'])
  const linkedPath = `${repoPath}-linked`
  offlineWorktreePath = linkedPath
  await git(repoPath, ['worktree', 'add', '-b', 'linked', linkedPath])
  await mkdir(path.join(repoPath, '.git', 'worktrees', 'unrelated-incomplete'))

  const membership = await readWorktreeMembership(repoPath)

  await expect(readRepoWorktreeSnapshots(repoPath, membership)).resolves.toHaveLength(2)
})

async function readAttachedRepoWorktreeSnapshots() {
  return await readRepoWorktreeSnapshots(repoPath, [
    {
      path: repoPath,
      headOid: '0123456789abcdef0123456789abcdef01234567',
      branch: 'main',
      isBare: false,
      isPrimary: true,
    },
  ])
}

async function gitPath(name: string): Promise<string> {
  const resolved = await git(repoPath, ['rev-parse', '--git-path', name])
  return path.isAbsolute(resolved) ? resolved : path.resolve(repoPath, resolved)
}
