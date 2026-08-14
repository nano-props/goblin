import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterEach, describe, expect, test } from 'vitest'
import { remoteGitOperationStateScript } from '#/system/ssh/remote-git-operation-state-script.ts'

const tempDirectories: string[] = []
const describePosix = process.platform === 'win32' ? describe.skip : describe

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map(async (directory) => await rm(directory, { recursive: true })))
})

describePosix('remote Git operation state script', () => {
  test('fails when Git cannot resolve administrative paths', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'goblin remote operation failure '))
    tempDirectories.push(directory)

    const result = await execa('sh', ['-c', primaryOperationStateScript(directory)], { reject: false })

    expect(result.exitCode).not.toBe(0)
  })

  test('fails when a linked worktree has no matching administrative directory', async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), 'goblin remote operation mapping '))
    tempDirectories.push(repoPath)
    await execa('git', ['init', '-q', repoPath])

    const result = await execa(
      'sh',
      ['-c', remoteGitOperationStateScript(path.join(repoPath, '.git'), '/missing/worktree', false, null)],
      { reject: false },
    )

    expect(result.exitCode).not.toBe(0)
  })

  test('ignores an unrelated malformed administrative pointer', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'goblin remote unrelated admin '))
    tempDirectories.push(parent)
    const repoPath = path.join(parent, 'repo')
    const linkedPath = path.join(parent, 'linked')
    await execa('git', ['init', '-q', '--initial-branch=main', repoPath])
    await createBranch(repoPath, 'linked')
    await execa('git', ['-C', repoPath, 'worktree', 'add', linkedPath, 'linked'])
    const commonDir = await realpath(path.join(repoPath, '.git'))
    const canonicalLinkedPath = await realpath(linkedPath)
    const unrelatedAdminDir = path.join(commonDir, 'worktrees', 'unrelated')
    await mkdir(unrelatedAdminDir)
    await writeFile(path.join(unrelatedAdminDir, 'gitdir'), '../../../../../../../../bad/.git\n')

    const state = await execa('sh', [
      '-c',
      remoteGitOperationStateScript(commonDir, canonicalLinkedPath, false, 'linked'),
    ])

    expect(state.stdout).toBe('operation none\nmaterialized-branch linked')
  })

  test('fails when the target worktree has only a malformed administrative pointer', async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), 'goblin remote malformed admin '))
    tempDirectories.push(repoPath)
    await execa('git', ['init', '-q', repoPath])
    const commonDir = await realpath(path.join(repoPath, '.git'))
    const targetAdminDir = path.join(commonDir, 'worktrees', 'target')
    await mkdir(targetAdminDir, { recursive: true })
    await writeFile(path.join(targetAdminDir, 'gitdir'), '../../../../../../../../target/.git\n')

    const result = await execa('sh', ['-c', remoteGitOperationStateScript(commonDir, '/target', false, null)], {
      reject: false,
    })

    expect(result.exitCode).not.toBe(0)
  })

  test('fails when multiple administrative directories identify the target worktree', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'goblin remote duplicate admin '))
    tempDirectories.push(parent)
    const repoPath = path.join(parent, 'repo')
    const linkedPath = path.join(parent, 'linked')
    await execa('git', ['init', '-q', '--initial-branch=main', repoPath])
    await createBranch(repoPath, 'linked')
    await execa('git', ['-C', repoPath, 'worktree', 'add', linkedPath, 'linked'])
    const commonDir = await realpath(path.join(repoPath, '.git'))
    const canonicalLinkedPath = await realpath(linkedPath)
    const duplicateAdminDir = path.join(commonDir, 'worktrees', 'duplicate')
    await mkdir(duplicateAdminDir)
    await writeFile(path.join(duplicateAdminDir, 'gitdir'), `${canonicalLinkedPath}/.git\n`)

    const result = await execa(
      'sh',
      ['-c', remoteGitOperationStateScript(commonDir, canonicalLinkedPath, false, 'linked')],
      { reject: false },
    )

    expect(result.exitCode).not.toBe(0)
  })

  test('reads operation markers from a safely quoted repository path', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'goblin remote operation '))
    tempDirectories.push(parent)
    const repoPath = path.join(parent, 'repo with spaces')
    await execa('git', ['init', '-q', repoPath])

    const none = await execa('sh', ['-c', primaryOperationStateScript(repoPath)])
    expect(none.stdout).toBe('operation none\nmaterialized-branch')

    const resolvedMergeHeadPath = (await execa('git', ['-C', repoPath, 'rev-parse', '--git-path', 'MERGE_HEAD'])).stdout
    const mergeHeadPath = path.isAbsolute(resolvedMergeHeadPath)
      ? resolvedMergeHeadPath
      : path.join(repoPath, resolvedMergeHeadPath)
    await mkdir(path.dirname(mergeHeadPath), { recursive: true })
    await writeFile(mergeHeadPath, '1111111111111111111111111111111111111111\n')

    const merge = await execa('sh', ['-c', primaryOperationStateScript(repoPath)])
    expect(merge.stdout).toBe('operation merge\nmaterialized-branch')
  })

  test.each(['rebase-merge', 'rebase-apply'])('ignores a non-directory %s marker', async (marker) => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), 'goblin remote rebase marker '))
    tempDirectories.push(repoPath)
    await execa('git', ['init', '-q', repoPath])
    const resolved = (await execa('git', ['-C', repoPath, 'rev-parse', '--git-path', marker])).stdout
    const markerPath = path.isAbsolute(resolved) ? resolved : path.join(repoPath, resolved)
    await writeFile(markerPath, 'not a rebase directory\n')

    const state = await execa('sh', ['-c', primaryOperationStateScript(repoPath)])

    expect(state.stdout).toBe('operation none\nmaterialized-branch')
  })

  test.each([
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['MERGE_HEAD', 'merge'],
  ] as const)('retains bisect branch authority while presenting a concurrent %s', async (marker, kind) => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), 'goblin remote concurrent operation '))
    tempDirectories.push(repoPath)
    await execa('git', ['init', '-q', repoPath])
    await createBranch(repoPath, 'feature/example')
    await writeFile(await resolveGitPath(repoPath, 'BISECT_LOG'), 'git bisect start\n')
    await writeFile(await resolveGitPath(repoPath, 'BISECT_START'), 'feature/example\n')
    await writeFile(await resolveGitPath(repoPath, marker), '1111111111111111111111111111111111111111\n')

    const state = await execa('sh', ['-c', primaryOperationStateScript(repoPath)])

    expect(state.stdout).toBe(`operation ${kind}\nmaterialized-branch feature/example`)
  })

  test.each([null, 'plain/branch', 'detached HEAD'])(
    'falls back to bisect branch authority when rebase head-name is %s',
    async (headName) => {
      const repoPath = await mkdtemp(path.join(os.tmpdir(), 'goblin remote rebase bisect '))
      tempDirectories.push(repoPath)
      await execa('git', ['init', '-q', repoPath])
      await createBranch(repoPath, 'feature/example')
      const rebaseMergePath = await resolveGitPath(repoPath, 'rebase-merge')
      await mkdir(rebaseMergePath)
      if (headName !== null) await writeFile(path.join(rebaseMergePath, 'head-name'), `${headName}\n`)
      await writeFile(await resolveGitPath(repoPath, 'BISECT_LOG'), 'git bisect start\n')
      await writeFile(await resolveGitPath(repoPath, 'BISECT_START'), 'feature/example\n')

      const state = await execa('sh', ['-c', primaryOperationStateScript(repoPath)])

      expect(state.stdout).toBe('operation rebase\nmaterialized-branch refs/heads/feature/example')
    },
  )

  test('keeps a hexadecimal branch name as bisect ownership when the ref exists', async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), 'goblin remote hexadecimal branch '))
    tempDirectories.push(repoPath)
    await execa('git', ['init', '-q', repoPath])
    const branchName = 'a'.repeat(41)
    await createBranch(repoPath, branchName)
    await writeFile(await resolveGitPath(repoPath, 'BISECT_LOG'), 'git bisect start\n')
    await writeFile(await resolveGitPath(repoPath, 'BISECT_START'), `${branchName}\n`)

    const state = await execa('sh', ['-c', primaryOperationStateScript(repoPath)])

    expect(state.stdout).toBe(`operation bisect\nmaterialized-branch ${branchName}`)
  })

  test('does not infer a bisect branch from a detached object id', async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), 'goblin remote detached bisect '))
    tempDirectories.push(repoPath)
    await execa('git', ['init', '-q', repoPath])
    await writeFile(await resolveGitPath(repoPath, 'BISECT_LOG'), 'git bisect start\n')
    await writeFile(await resolveGitPath(repoPath, 'BISECT_START'), `${'a'.repeat(40)}\n`)

    const state = await execa('sh', ['-c', primaryOperationStateScript(repoPath)])

    expect(state.stdout).toBe('operation bisect\nmaterialized-branch')
  })

  test.each([
    ['absolute', []],
    ['relative', ['--relative-paths']],
  ] as const)(
    'reads linked bisect ownership through a %s administrative pointer while its path is offline',
    async (_, flags) => {
      const parent = await mkdtemp(path.join(os.tmpdir(), 'goblin remote locked worktree '))
      tempDirectories.push(parent)
      const repoPath = path.join(parent, 'repo')
      const linkedPath = path.join(parent, 'portable')
      const offlinePath = path.join(parent, 'portable-offline')
      await execa('git', ['init', '-q', '--initial-branch=main', repoPath])
      await execa('git', ['-C', repoPath, 'config', 'user.email', 'example@example.invalid'])
      await execa('git', ['-C', repoPath, 'config', 'user.name', 'Example'])
      await writeFile(path.join(repoPath, 'file.txt'), 'initial\n')
      await execa('git', ['-C', repoPath, 'add', 'file.txt'])
      await execa('git', ['-C', repoPath, 'commit', '-qm', 'initial'])
      await execa('git', ['-C', repoPath, 'worktree', 'add', ...flags, '-qb', 'portable', linkedPath])
      await execa('git', ['-C', repoPath, 'worktree', 'lock', '--reason', 'portable', linkedPath])
      const linkedGitDir = (await execa('git', ['-C', linkedPath, 'rev-parse', '--absolute-git-dir'])).stdout
      await writeFile(path.join(linkedGitDir, 'BISECT_LOG'), 'git bisect start\n')
      await writeFile(path.join(linkedGitDir, 'BISECT_START'), 'portable\n')
      const canonicalLinkedPath = await realpath(linkedPath)
      await rename(linkedPath, offlinePath)

      const state = await execa('sh', [
        '-c',
        remoteGitOperationStateScript(await realpath(path.join(repoPath, '.git')), canonicalLinkedPath, false, null),
      ])

      expect(state.stdout).toBe('operation bisect\nmaterialized-branch portable')
    },
  )
})

async function resolveGitPath(repoPath: string, marker: string): Promise<string> {
  const resolved = (await execa('git', ['-C', repoPath, 'rev-parse', '--git-path', marker])).stdout
  return path.isAbsolute(resolved) ? resolved : path.join(repoPath, resolved)
}

function primaryOperationStateScript(repoPath: string): string {
  return remoteGitOperationStateScript(path.join(repoPath, '.git'), repoPath, true, null)
}

async function createBranch(repoPath: string, branchName: string): Promise<void> {
  await execa('git', ['-C', repoPath, 'config', 'user.email', 'example@example.invalid'])
  await execa('git', ['-C', repoPath, 'config', 'user.name', 'Example'])
  await writeFile(path.join(repoPath, 'tracked.txt'), 'tracked\n')
  await execa('git', ['-C', repoPath, 'add', 'tracked.txt'])
  await execa('git', ['-C', repoPath, 'commit', '-qm', 'initial'])
  await execa('git', ['-C', repoPath, 'branch', branchName])
}
