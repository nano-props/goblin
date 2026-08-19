import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterEach, describe, expect, test } from 'vitest'
import { remoteGitRemotesScript } from '#/system/ssh/remote-git-remotes-script.ts'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map(async (directory) => await rm(directory, { recursive: true })))
})

describe('remote Git remotes script', () => {
  test('emits canonical fetch and push URLs as NUL-delimited records', async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), 'goblin remote urls '))
    tempDirectories.push(repoPath)
    await execa('git', ['init', '-q', repoPath])
    await execa('git', ['-C', repoPath, 'remote', 'add', 'origin', 'https://example.test/fetch.git'])
    await execa('git', ['-C', repoPath, 'remote', 'set-url', '--push', 'origin', 'https://example.test/push.git'])

    const result = await execa('bash', ['-lc', remoteGitRemotesScript(repoPath)])

    expect(result.stdout).toBe('origin\0https://example.test/fetch.git\0https://example.test/push.git\0')
  })

  test('fails when Git cannot read the repository', async () => {
    const result = await execa('bash', ['-lc', remoteGitRemotesScript('/definitely/not-a-repository')], {
      reject: false,
    })

    expect(result.exitCode).not.toBe(0)
  })
})
