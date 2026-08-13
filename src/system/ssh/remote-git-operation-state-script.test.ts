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
  test('reads operation markers from a safely quoted repository path', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'goblin remote operation '))
    tempDirectories.push(parent)
    const repoPath = path.join(parent, 'repo with spaces')
    await execa('git', ['init', '-q', repoPath])

    const none = await execa('sh', ['-c', remoteGitOperationStateScript(repoPath)])
    expect(none.stdout).toBe('none')

    const resolvedMergeHeadPath = (await execa('git', ['-C', repoPath, 'rev-parse', '--git-path', 'MERGE_HEAD'])).stdout
    const mergeHeadPath = path.isAbsolute(resolvedMergeHeadPath)
      ? resolvedMergeHeadPath
      : path.join(repoPath, resolvedMergeHeadPath)
    await mkdir(path.dirname(mergeHeadPath), { recursive: true })
    await writeFile(mergeHeadPath, '1111111111111111111111111111111111111111\n')

    const merge = await execa('sh', ['-c', remoteGitOperationStateScript(repoPath)])
    expect(merge.stdout).toBe('merge')
  })
})
