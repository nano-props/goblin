import { chmod, mkdtempDisposable, mkdir, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseRemoteDirectoryOverview,
  readLocalDirectoryOverview,
} from '#/server/modules/workspace-directory-overview.ts'

describe('workspace directory overview', () => {
  it('counts only direct entries while summing nested regular files', async () => {
    await using temporaryRoot = await mkdtempDisposable(path.join(os.tmpdir(), 'goblin-overview-'))
    const root = temporaryRoot.path
    await mkdir(path.join(root, 'src', 'nested'), { recursive: true })
    await writeFile(path.join(root, 'README.md'), 'abc')
    await writeFile(path.join(root, 'invalid-fixture.asar'), 'not an Electron archive')
    await writeFile(path.join(root, 'src', 'index.ts'), '12345')
    await writeFile(path.join(root, 'src', 'nested', 'data'), '1234567')
    await expect(readLocalDirectoryOverview(root)).resolves.toEqual({
      topLevelFileCount: 2,
      topLevelDirectoryCount: 1,
      totalSizeBytes: 38,
    })
  })

  it('does not count or traverse symbolic links', async () => {
    await using temporaryRoot = await mkdtempDisposable(path.join(os.tmpdir(), 'goblin-overview-'))
    await using temporaryOutside = await mkdtempDisposable(path.join(os.tmpdir(), 'goblin-overview-outside-'))
    const root = temporaryRoot.path
    const outside = temporaryOutside.path
    await writeFile(path.join(root, 'inside.txt'), 'abc')
    await writeFile(path.join(outside, 'outside.txt'), 'not part of workspace')
    await symlink(path.join(outside, 'outside.txt'), path.join(root, 'linked-file'))
    await symlink(outside, path.join(root, 'linked-directory'))

    await expect(readLocalDirectoryOverview(root)).resolves.toEqual({
      topLevelFileCount: 1,
      topLevelDirectoryCount: 0,
      totalSizeBytes: 3,
    })
  })

  it.runIf(process.platform !== 'win32')('keeps root facts when a nested size cannot be inspected', async () => {
    await using temporaryRoot = await mkdtempDisposable(path.join(os.tmpdir(), 'goblin-overview-'))
    const root = temporaryRoot.path
    const unreadable = path.join(root, 'unreadable')
    await mkdir(unreadable)
    await writeFile(path.join(root, 'visible.txt'), 'abc')
    await writeFile(path.join(unreadable, 'hidden.txt'), 'not available to the scan')
    await chmod(unreadable, 0o000)

    try {
      await expect(readLocalDirectoryOverview(root)).resolves.toEqual({
        topLevelFileCount: 1,
        topLevelDirectoryCount: 1,
        totalSizeBytes: null,
      })
    } finally {
      await chmod(unreadable, 0o700)
    }
  })

  it('rejects malformed remote output instead of guessing', () => {
    expect(parseRemoteDirectoryOverview('2\t3\t4096\n')).toEqual({
      topLevelFileCount: 2,
      topLevelDirectoryCount: 3,
      totalSizeBytes: 4096,
    })
    for (const malformed of ['2\tbad\t4096', '\t\t-', '01\t2\t3', '1e2\t2\t3', ' 2\t2\t3']) {
      expect(() => parseRemoteDirectoryOverview(malformed)).toThrow('invalid remote directory overview')
    }
    expect(parseRemoteDirectoryOverview('2\t3\t-\n')).toEqual({
      topLevelFileCount: 2,
      topLevelDirectoryCount: 3,
      totalSizeBytes: null,
    })
  })
})
