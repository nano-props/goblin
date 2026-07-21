import type { Dirent } from 'node:fs'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getLocalPathSuggestionsForHost } from '#/server/modules/local-path-suggestions.ts'

const mocks = vi.hoisted(() => ({
  opendir: vi.fn(),
  stat: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({ opendir: mocks.opendir, stat: mocks.stat }))

describe('getLocalPathSuggestions filesystem boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  test('stops inspecting after the bounded entry budget and closes the handle', async () => {
    const directory = fakeDirectory(Array.from({ length: 600 }, (_, index) => fileEntry(`file-${index}`)))
    mocks.opendir.mockResolvedValue(directory)

    await expect(suggest('/root/match')).resolves.toEqual([])
    expect(directory.read).toHaveBeenCalledTimes(500)
    expect(directory.close).toHaveBeenCalledOnce()
  })

  test('propagates an in-flight abort and closes the handle', async () => {
    const controller = new AbortController()
    const directory = fakeDirectory([fileEntry('first'), fileEntry('second')], () =>
      controller.abort(new Error('stop')),
    )
    mocks.opendir.mockResolvedValue(directory)

    await expect(suggest('/root/', controller.signal)).rejects.toThrow('stop')
    expect(directory.close).toHaveBeenCalledOnce()
  })

  test('maps an expected read error to no results and still closes the handle', async () => {
    const directory = fakeDirectory([])
    directory.read.mockRejectedValueOnce(filesystemError('EACCES'))
    mocks.opendir.mockResolvedValue(directory)

    await expect(suggest('/root/')).resolves.toEqual([])
    expect(directory.close).toHaveBeenCalledOnce()
  })

  test('propagates unexpected open and symlink stat errors', async () => {
    mocks.opendir.mockRejectedValueOnce(filesystemError('EIO'))
    await expect(suggest('/root/')).rejects.toMatchObject({ code: 'EIO' })

    const directory = fakeDirectory([symlinkEntry('linked')])
    mocks.opendir.mockResolvedValueOnce(directory)
    mocks.stat.mockRejectedValueOnce(filesystemError('EIO'))
    await expect(suggest('/root/l')).rejects.toMatchObject({ code: 'EIO' })
    expect(directory.close).toHaveBeenCalledOnce()
  })

  test('stats an entry whose filesystem does not expose a directory type', async () => {
    const directory = fakeDirectory([unknownEntry('unknown-directory')])
    mocks.opendir.mockResolvedValueOnce(directory)
    mocks.stat.mockResolvedValueOnce({ isDirectory: () => true })

    await expect(suggest('/root/u')).resolves.toEqual(['/root/unknown-directory'])
    expect(mocks.stat).toHaveBeenCalledWith('/root/unknown-directory')
    expect(directory.close).toHaveBeenCalledOnce()
  })

  test('maps an overlong native path to no results', async () => {
    mocks.opendir.mockRejectedValueOnce(filesystemError('ENAMETOOLONG'))
    await expect(suggest(`/root/${'a'.repeat(4000)}`)).resolves.toEqual([])
  })
})

async function suggest(prefix: string, signal?: AbortSignal): Promise<string[]> {
  return await getLocalPathSuggestionsForHost({ prefix, platform: 'posix', homeDir: '/home/example', signal })
}

function fakeDirectory(entries: Dirent[], afterFirstRead?: () => void) {
  let index = 0
  return {
    read: vi.fn(async () => {
      const entry = entries[index++] ?? null
      if (index === 1) afterFirstRead?.()
      return entry
    }),
    close: vi.fn(async () => {}),
  }
}

function fileEntry(name: string): Dirent {
  return directoryEntry(name, 'file')
}

function symlinkEntry(name: string): Dirent {
  return directoryEntry(name, 'symlink')
}

function unknownEntry(name: string): Dirent {
  return directoryEntry(name, 'unknown')
}

function directoryEntry(name: string, kind: 'file' | 'symlink' | 'unknown'): Dirent {
  return {
    name,
    parentPath: '/root',
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isDirectory: () => false,
    isFIFO: () => false,
    isFile: () => kind === 'file',
    isSocket: () => false,
    isSymbolicLink: () => kind === 'symlink',
  }
}

function filesystemError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}
