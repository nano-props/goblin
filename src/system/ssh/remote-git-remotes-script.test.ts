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
  test('preserves URL whitespace in NUL-delimited records', async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), 'goblin remote urls '))
    tempDirectories.push(repoPath)
    await execa('git', ['init', '-q', repoPath])
    const fetchUrl = 'https://example.test/fetch.git \n'
    const pushUrl = 'https://example.test/push.git\npath '
    await execa('git', ['-C', repoPath, 'remote', 'add', 'origin', fetchUrl])
    await execa('git', ['-C', repoPath, 'remote', 'set-url', '--push', 'origin', pushUrl])

    const result = await execa('bash', ['-lc', remoteGitRemotesScript(repoPath)])

    expect(result.stdout).toBe(`origin\0${fetchUrl}\0${pushUrl}\0`)
  })

  test('fails when Git cannot read the repository', async () => {
    const result = await execa('bash', ['-lc', remoteGitRemotesScript('/definitely/not-a-repository')], {
      reject: false,
    })

    expect(result.exitCode).not.toBe(0)
  })
})
