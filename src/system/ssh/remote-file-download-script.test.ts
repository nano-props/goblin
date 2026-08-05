import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterEach, describe, expect, test } from 'vitest'
import { remoteFileDownloadStreamScript } from '#/system/ssh/remote-file-download-script.ts'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('remote file download script', () => {
  test.runIf(process.platform !== 'win32')('streams a regular file and rejects symlinked path segments', async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), 'goblin-download-command-'))
    const root = path.join(fixture, 'root')
    const outside = path.join(fixture, 'outside')
    tempDirs.push(fixture)
    await mkdir(path.join(root, 'src'), { recursive: true })
    await mkdir(outside)
    await writeFile(path.join(root, 'src', 'file.txt'), 'expected')
    await writeFile(path.join(outside, 'secret.txt'), 'private')
    const marker = '__GOBLIN_DOWNLOAD_TEST__'

    await expect(
      execa('bash', ['-lc', remoteFileDownloadStreamScript(root, 'src/file.txt', marker)]),
    ).resolves.toMatchObject({ stdout: `${marker}\nexpected` })

    await symlink(outside, path.join(root, 'linked'))
    const escaped = remoteFileDownloadStreamScript(root, 'linked/secret.txt', marker)
    const escapedResult = await execa('bash', ['-lc', escaped], { reject: false })
    expect(escapedResult.exitCode).not.toBe(0)
    expect(escapedResult.stderr).toContain('error.file-download-symlink-unsupported')
  })
})
