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

  test('retains the bisected branch while presenting a concurrent cherry-pick', async () => {
    await writeFile(await gitPath('BISECT_LOG'), 'git bisect start\n')
    await writeFile(await gitPath('BISECT_START'), 'feature/example\n')
    await writeFile(await gitPath('CHERRY_PICK_HEAD'), '0123456789abcdef\n')

    await expect(readGitWorktreeState(repoPath)).resolves.toEqual({
      operation: { kind: 'cherry-pick' },
      materializedBranch: 'feature/example',
    })
  })

  test('retains the bisected branch while presenting a concurrent merge', async () => {
    await writeFile(await gitPath('BISECT_LOG'), 'git bisect start\n')
    await writeFile(await gitPath('BISECT_START'), 'feature/example\n')
    await writeFile(await gitPath('MERGE_HEAD'), '0123456789abcdef\n')

    await expect(readGitWorktreeState(repoPath)).resolves.toEqual({
      operation: { kind: 'merge' },
      materializedBranch: 'feature/example',
    })
  })
})

test('excludes bare repositories from routable worktree membership', async () => {
  await expect(readRepoWorktreeSnapshots([{ path: repoPath, isBare: true, isPrimary: true }])).resolves.toEqual([])
})

async function gitPath(name: string): Promise<string> {
  const resolved = await git(repoPath, ['rev-parse', '--git-path', name])
  return path.isAbsolute(resolved) ? resolved : path.resolve(repoPath, resolved)
}
