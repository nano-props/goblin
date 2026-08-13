import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { git } from '#/system/git/git-exec.ts'
import { readGitWorktreeState, readRepoWorktreeSnapshots } from '#/system/git/worktree-state.ts'

let repoPath = ''

beforeEach(async () => {
  repoPath = await mkdtemp(path.join(os.tmpdir(), 'goblin-worktree-state-'))
  await git(repoPath, ['init', '--initial-branch=main'])
})

afterEach(async () => {
  if (repoPath) await rm(repoPath, { recursive: true, force: true })
})

describe('readGitWorktreeState', () => {
  test('returns null outside an in-progress operation', async () => {
    await expect(readGitWorktreeState(repoPath)).resolves.toEqual({ operation: null, materializedBranch: null })
  })

  test('reads the rebased branch from either rebase administration format', async () => {
    const rebaseMergePath = await gitPath('rebase-merge')
    await mkdir(rebaseMergePath)
    await writeFile(path.join(rebaseMergePath, 'head-name'), 'refs/heads/feature/example\n')
    await expect(readGitWorktreeState(repoPath)).resolves.toEqual({
      operation: { kind: 'rebase' },
      materializedBranch: 'feature/example',
    })

    await rm(rebaseMergePath, { recursive: true })
    await mkdir(await gitPath('rebase-apply'))
    await expect(readGitWorktreeState(repoPath)).resolves.toEqual({
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

      await expect(readGitWorktreeState(repoPath)).resolves.toEqual({
        operation: { kind: 'rebase' },
        materializedBranch: 'feature/example',
      })
    },
  )

  test.each(['rebase-merge', 'rebase-apply'])('ignores a non-directory %s marker', async (marker) => {
    await writeFile(await gitPath(marker), 'not a rebase directory\n')

    await expect(readGitWorktreeState(repoPath)).resolves.toEqual({ operation: null, materializedBranch: null })
  })

  test.each([
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert'],
    ['MERGE_HEAD', 'merge'],
  ] as const)('detects %s', async (marker, kind) => {
    await writeFile(await gitPath(marker), '0123456789abcdef\n')
    await expect(readGitWorktreeState(repoPath)).resolves.toEqual({ operation: { kind }, materializedBranch: null })
  })

  test('reads the branch retained by an in-progress bisect', async () => {
    await writeFile(await gitPath('BISECT_LOG'), 'git bisect start\n')
    await writeFile(await gitPath('BISECT_START'), 'feature/example\n')

    await expect(readGitWorktreeState(repoPath)).resolves.toEqual({
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

    await expect(readGitWorktreeState(repoPath)).resolves.toEqual({
      operation: { kind },
      materializedBranch: 'feature/example',
    })
  })
})

test('excludes bare repositories from routable worktree membership', async () => {
  await expect(readRepoWorktreeSnapshots([{ path: repoPath, isBare: true, isPrimary: true }])).resolves.toEqual([])
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

async function readAttachedRepoWorktreeSnapshots() {
  return await readRepoWorktreeSnapshots([
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
