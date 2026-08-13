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

  test('retains bisect branch authority while presenting a concurrent cherry-pick', async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), 'goblin remote concurrent operation '))
    tempDirectories.push(repoPath)
    await execa('git', ['init', '-q', repoPath])
    const resolveGitPath = async (marker: string) => {
      const resolved = (await execa('git', ['-C', repoPath, 'rev-parse', '--git-path', marker])).stdout
      return path.isAbsolute(resolved) ? resolved : path.join(repoPath, resolved)
    }
    await writeFile(await resolveGitPath('BISECT_LOG'), 'git bisect start\n')
    await writeFile(await resolveGitPath('BISECT_START'), 'feature/example\n')
    await writeFile(await resolveGitPath('CHERRY_PICK_HEAD'), '1111111111111111111111111111111111111111\n')

    const state = await execa('sh', ['-c', remoteGitOperationStateScript(repoPath, null)])

    expect(state.stdout).toBe('operation cherry-pick\nmaterialized-branch feature/example')
  })

  test('retains bisect branch authority while presenting a concurrent merge', async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), 'goblin remote concurrent merge '))
    tempDirectories.push(repoPath)
    await execa('git', ['init', '-q', repoPath])
    const resolveGitPath = async (marker: string) => {
      const resolved = (await execa('git', ['-C', repoPath, 'rev-parse', '--git-path', marker])).stdout
      return path.isAbsolute(resolved) ? resolved : path.join(repoPath, resolved)
    }
    await writeFile(await resolveGitPath('BISECT_LOG'), 'git bisect start\n')
    await writeFile(await resolveGitPath('BISECT_START'), 'feature/example\n')
    await writeFile(await resolveGitPath('MERGE_HEAD'), '1111111111111111111111111111111111111111\n')

    const state = await execa('sh', ['-c', remoteGitOperationStateScript(repoPath, null)])

    expect(state.stdout).toBe('operation merge\nmaterialized-branch feature/example')
  })
})
