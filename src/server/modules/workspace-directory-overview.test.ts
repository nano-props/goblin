import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseRemoteDirectoryOverview,
  readLocalDirectoryOverview,
} from '#/server/modules/workspace-directory-overview.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('workspace directory overview', () => {
  it('counts only direct entries while summing nested regular files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'goblin-overview-'))
    roots.push(root)
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
    const root = await mkdtemp(path.join(os.tmpdir(), 'goblin-overview-'))
    const outside = await mkdtemp(path.join(os.tmpdir(), 'goblin-overview-outside-'))
    roots.push(root, outside)
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

  it('rejects malformed remote output instead of guessing', () => {
    expect(parseRemoteDirectoryOverview('2\t3\t4096\n')).toEqual({
      topLevelFileCount: 2,
      topLevelDirectoryCount: 3,
      totalSizeBytes: 4096,
    })
    expect(() => parseRemoteDirectoryOverview('2\tbad\t4096')).toThrow('invalid remote directory overview')
  })
})
