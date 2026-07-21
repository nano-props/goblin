import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { getLocalPathSuggestions } from '#/server/modules/local-path-suggestions.ts'
import { workspaceLocatorFromNativeCommandInput } from '#/server/modules/native-workspace-input.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })),
  )
})

describe('getLocalPathSuggestions', () => {
  test('returns only matching directories in deterministic order', async () => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, 'alpha'))
    await mkdir(path.join(root, 'alpine'))
    await mkdir(path.join(root, 'beta'))
    await writeFile(path.join(root, 'almanac.txt'), '')

    await expect(getLocalPathSuggestions(path.join(root, 'al'))).resolves.toEqual([
      path.join(root, 'alpha'),
      path.join(root, 'alpine'),
    ])
  })

  test.runIf(process.platform !== 'win32')('includes directory symlinks and omits broken symlinks', async () => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, 'alpha'))
    await symlink(path.join(root, 'alpha'), path.join(root, 'alias'))
    await symlink(path.join(root, 'missing'), path.join(root, 'also-broken'))

    await expect(getLocalPathSuggestions(path.join(root, 'al'))).resolves.toEqual([
      path.join(root, 'alias'),
      path.join(root, 'alpha'),
    ])
  })

  test('limits output and observes an already-aborted request', async () => {
    const root = await temporaryDirectory()
    await Promise.all(Array.from({ length: 30 }, async (_, index) => await mkdir(path.join(root, `dir-${index}`))))
    expect(await getLocalPathSuggestions(`${root}${path.sep}`)).toHaveLength(20)

    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(getLocalPathSuggestions(`${root}${path.sep}`, controller.signal)).rejects.toThrow('cancelled')
  })

  test('maps a missing search root to an empty result', async () => {
    const root = await temporaryDirectory()
    await expect(getLocalPathSuggestions(path.join(root, 'missing', 'child'))).resolves.toEqual([])
  })

  test.runIf(process.platform !== 'win32')(
    'omits directories that final workspace admission cannot represent',
    async () => {
      const root = await temporaryDirectory()
      await mkdir(path.join(root, 'valid'))
      await mkdir(path.join(root, 'invalid\\name'))
      await mkdir(path.join(root, 'invalid\nname'))

      await expect(getLocalPathSuggestions(`${root}${path.sep}`)).resolves.toEqual([path.join(root, 'valid')])
    },
  )

  test.runIf(process.platform !== 'win32')('preserves trailing spaces from suggestion through admission', async () => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, 'repo'))
    await mkdir(path.join(root, 'repo '))

    const [suggestion] = await getLocalPathSuggestions(path.join(root, 'repo '))
    expect(suggestion).toBe(path.join(root, 'repo '))
    expect(workspaceLocatorFromNativeCommandInput(suggestion!, 'posix', '/home/example')).toContain('repo%20')
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'goblin-path-suggestions-'))
  temporaryDirectories.push(directory)
  return directory
}
