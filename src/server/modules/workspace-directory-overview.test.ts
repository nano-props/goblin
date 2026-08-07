import { mkdtempDisposable, mkdir, symlink, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseRemoteDirectoryOverview,
  readLocalDirectoryOverview,
} from '#/server/modules/workspace-directory-overview.ts'

describe('workspace directory overview', () => {
  it('counts only direct entries', async () => {
    await using temporaryRoot = await mkdtempDisposable(path.join(os.tmpdir(), 'goblin-overview-'))
    const root = temporaryRoot.path
    await mkdir(path.join(root, 'src', 'nested'), { recursive: true })
    await writeFile(path.join(root, 'README.md'), 'abc')
    await writeFile(path.join(root, 'invalid-fixture.asar'), 'not an Electron archive')
    await utimes(root, new Date('2023-11-14T22:13:20.000Z'), new Date('2023-11-14T22:13:20.000Z'))
    await expect(readLocalDirectoryOverview(root)).resolves.toEqual({
      topLevelFileCount: 2,
      topLevelDirectoryCount: 1,
      lastModifiedAt: '2023-11-14T22:13:20.000Z',
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
    await utimes(root, new Date('2023-11-14T22:13:20.000Z'), new Date('2023-11-14T22:13:20.000Z'))

    await expect(readLocalDirectoryOverview(root)).resolves.toEqual({
      topLevelFileCount: 1,
      topLevelDirectoryCount: 0,
      lastModifiedAt: '2023-11-14T22:13:20.000Z',
    })
  })

  it.runIf(process.platform !== 'win32')('reads the target directory through a symbolic link root', async () => {
    await using temporaryRoot = await mkdtempDisposable(path.join(os.tmpdir(), 'goblin-overview-'))
    const target = path.join(temporaryRoot.path, 'target')
    const link = path.join(temporaryRoot.path, 'link')
    await mkdir(target)
    await writeFile(path.join(target, 'inside.txt'), 'abc')
    await utimes(target, new Date('2023-11-14T22:13:20.000Z'), new Date('2023-11-14T22:13:20.000Z'))
    await symlink(target, link)

    await expect(readLocalDirectoryOverview(link)).resolves.toEqual({
      topLevelFileCount: 1,
      topLevelDirectoryCount: 0,
      lastModifiedAt: '2023-11-14T22:13:20.000Z',
    })
  })

  it('rejects malformed remote output instead of guessing', () => {
    expect(parseRemoteDirectoryOverview('2\t3\t1700000000\n')).toEqual({
      topLevelFileCount: 2,
      topLevelDirectoryCount: 3,
      lastModifiedAt: '2023-11-14T22:13:20.000Z',
    })
    expect(parseRemoteDirectoryOverview('2\t3\t-1\n').lastModifiedAt).toBe('1969-12-31T23:59:59.000Z')
    for (const malformed of ['2\tbad\t3', '\t\t', '01\t2\t3', '1e2\t2\t3', ' 2\t2\t3', '2\t3\tbad']) {
      expect(() => parseRemoteDirectoryOverview(malformed)).toThrow('invalid remote directory overview')
    }
  })
})
