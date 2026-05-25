import { afterEach, describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createWorktree, removeWorktree } from '#/main/git/worktrees.ts'

let tmp: string | null = null
const extraPaths: string[] = []

function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function createRepo(): string {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-worktrees-test-'))
  runGit(tmp, ['init', '-b', 'main'])
  runGit(tmp, ['config', 'user.email', 'test@example.com'])
  runGit(tmp, ['config', 'user.name', 'Test User'])
  writeFileSync(path.join(tmp, 'README.md'), 'initial\n')
  runGit(tmp, ['add', 'README.md'])
  runGit(tmp, ['commit', '-q', '-m', 'initial'])
  return tmp
}

function abortedSignal(): AbortSignal {
  const ctrl = new AbortController()
  ctrl.abort()
  return ctrl.signal
}

afterEach(() => {
  for (const p of extraPaths.splice(0)) rmSync(p, { recursive: true, force: true })
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
})

describe('worktree git operations', () => {
  test('does not create a worktree when already aborted', async () => {
    const repo = createRepo()
    const worktreePath = path.join(path.dirname(repo), `${path.basename(repo)}-aborted-create-worktree`)
    extraPaths.push(worktreePath)

    const result = await createWorktree(repo, worktreePath, 'feature/aborted', 'main', abortedSignal())

    expect(result).toEqual({ ok: false, message: 'cancelled' })
    expect(existsSync(worktreePath)).toBe(false)
  })

  test('does not remove a worktree when already aborted', async () => {
    const repo = createRepo()
    const worktreePath = path.join(path.dirname(repo), `${path.basename(repo)}-aborted-remove-worktree`)
    extraPaths.push(worktreePath)
    runGit(repo, ['worktree', 'add', '-b', 'feature/remove', '--', worktreePath, 'main'])

    const result = await removeWorktree(repo, worktreePath, abortedSignal())

    expect(result).toEqual({ ok: false, message: 'cancelled' })
    expect(existsSync(worktreePath)).toBe(true)
  })
})
