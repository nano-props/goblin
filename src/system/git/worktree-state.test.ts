import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { git } from '#/system/git/git-exec.ts'
import { readGitOperation, readRepoWorktreeSnapshots } from '#/system/git/worktree-state.ts'

let repoPath = ''

beforeEach(async () => {
  repoPath = await mkdtemp(path.join(os.tmpdir(), 'goblin-worktree-state-'))
  await git(repoPath, ['init', '--initial-branch=main'])
})

afterEach(async () => {
  if (repoPath) await rm(repoPath, { recursive: true, force: true })
})

describe('readGitOperation', () => {
  test('returns null outside an in-progress operation', async () => {
    await expect(readGitOperation(repoPath)).resolves.toBeNull()
  })

  test('reads the rebased branch from either rebase administration format', async () => {
    const rebaseMergePath = await gitPath('rebase-merge')
    await mkdir(rebaseMergePath)
    await writeFile(path.join(rebaseMergePath, 'head-name'), 'refs/heads/feature/example\n')
    await expect(readGitOperation(repoPath)).resolves.toEqual({
      kind: 'rebase',
      branchName: 'feature/example',
    })

    await rm(rebaseMergePath, { recursive: true })
    await mkdir(await gitPath('rebase-apply'))
    await expect(readGitOperation(repoPath)).resolves.toEqual({ kind: 'rebase', branchName: null })
  })

  test.each([
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert'],
    ['BISECT_LOG', 'bisect'],
    ['MERGE_HEAD', 'merge'],
  ] as const)('detects %s', async (marker, kind) => {
    await writeFile(await gitPath(marker), '0123456789abcdef\n')
    await expect(readGitOperation(repoPath)).resolves.toEqual({ kind })
  })
})

test('excludes bare repositories from routable worktree membership', async () => {
  await expect(readRepoWorktreeSnapshots([{ path: repoPath, isBare: true, isPrimary: true }])).resolves.toEqual([])
})

async function gitPath(name: string): Promise<string> {
  const resolved = await git(repoPath, ['rev-parse', '--git-path', name])
  return path.isAbsolute(resolved) ? resolved : path.resolve(repoPath, resolved)
}
