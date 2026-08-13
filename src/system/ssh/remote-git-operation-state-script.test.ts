import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterEach, describe, expect, test } from 'vitest'
import { remoteGitOperationStateScript } from '#/system/ssh/remote-git-operation-state-script.ts'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map(async (directory) => await rm(directory, { recursive: true })))
})

describe('remote Git operation state script', () => {
  test('fails when Git cannot resolve administrative paths', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'goblin remote operation failure '))
    tempDirectories.push(directory)

    const result = await execa('sh', ['-c', remoteGitOperationStateScript(directory, null)], { reject: false })

    expect(result.exitCode).not.toBe(0)
  })

  test('reads operation markers from a safely quoted repository path', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'goblin remote operation '))
    tempDirectories.push(parent)
    const repoPath = path.join(parent, 'repo with spaces')
    await execa('git', ['init', '-q', repoPath])

    const none = await execa('sh', ['-c', remoteGitOperationStateScript(repoPath, null)])
    expect(none.stdout).toBe('operation none\nmaterialized-branch')

    const resolvedMergeHeadPath = (await execa('git', ['-C', repoPath, 'rev-parse', '--git-path', 'MERGE_HEAD'])).stdout
    const mergeHeadPath = path.isAbsolute(resolvedMergeHeadPath)
      ? resolvedMergeHeadPath
      : path.join(repoPath, resolvedMergeHeadPath)
    await mkdir(path.dirname(mergeHeadPath), { recursive: true })
    await writeFile(mergeHeadPath, '1111111111111111111111111111111111111111\n')

    const merge = await execa('sh', ['-c', remoteGitOperationStateScript(repoPath, null)])
    expect(merge.stdout).toBe('operation merge\nmaterialized-branch')
  })

  test.each(['rebase-merge', 'rebase-apply'])('ignores a non-directory %s marker', async (marker) => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), 'goblin remote rebase marker '))
    tempDirectories.push(repoPath)
    await execa('git', ['init', '-q', repoPath])
    const resolved = (await execa('git', ['-C', repoPath, 'rev-parse', '--git-path', marker])).stdout
    const markerPath = path.isAbsolute(resolved) ? resolved : path.join(repoPath, resolved)
    await writeFile(markerPath, 'not a rebase directory\n')

    const state = await execa('sh', ['-c', remoteGitOperationStateScript(repoPath, null)])

    expect(state.stdout).toBe('operation none\nmaterialized-branch')
  })

  test.each([
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['MERGE_HEAD', 'merge'],
  ] as const)('retains bisect branch authority while presenting a concurrent %s', async (marker, kind) => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), 'goblin remote concurrent operation '))
    tempDirectories.push(repoPath)
    await execa('git', ['init', '-q', repoPath])
    await writeFile(await resolveGitPath(repoPath, 'BISECT_LOG'), 'git bisect start\n')
    await writeFile(await resolveGitPath(repoPath, 'BISECT_START'), 'feature/example\n')
    await writeFile(await resolveGitPath(repoPath, marker), '1111111111111111111111111111111111111111\n')

    const state = await execa('sh', ['-c', remoteGitOperationStateScript(repoPath, null)])

    expect(state.stdout).toBe(`operation ${kind}\nmaterialized-branch feature/example`)
  })
})

async function resolveGitPath(repoPath: string, marker: string): Promise<string> {
  const resolved = (await execa('git', ['-C', repoPath, 'rev-parse', '--git-path', marker])).stdout
  return path.isAbsolute(resolved) ? resolved : path.join(repoPath, resolved)
}
