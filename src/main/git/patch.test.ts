import { afterEach, describe, expect, test } from 'vitest'
import { execaSync } from 'execa'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getWorktreePatch } from '#/main/git/patch.ts'

let tmp: string | null = null

function git(cwd: string, ...args: string[]) {
  execaSync('git', args, { cwd, stdio: 'ignore' })
}

function initRepo(): string {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-patch-test-'))
  git(tmp, 'init')
  git(tmp, 'config', 'user.email', 'test@example.com')
  git(tmp, 'config', 'user.name', 'Test User')
  writeFileSync(path.join(tmp, 'README.md'), 'hello\n')
  git(tmp, 'add', 'README.md')
  git(tmp, 'commit', '-m', 'initial')
  return tmp
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
})

describe('getWorktreePatch', () => {
  test('includes untracked files in the generated patch', async () => {
    const repo = initRepo()
    writeFileSync(path.join(repo, 'new file.txt'), 'untracked\n')

    const patch = await getWorktreePatch(repo)

    expect(patch).toContain('new file mode')
    expect(patch).toContain('new file.txt')
    expect(patch).toContain('+untracked')
  })
})
