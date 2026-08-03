import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { Readable, Writable } from 'node:stream'
import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { afterEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pipeline: vi.fn(),
}))

vi.mock('node:stream/promises', () => ({
  pipeline: mocks.pipeline,
}))

import { copyPath, DestinationPermissionRestoreError } from '#/system/filesystem-copy.ts'

let temporaryDirectory: string | null = null
const SPARSE_TEST_FILE_SIZE = 16 * 1024 * 1024

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = null
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

test('restores a partial destination directory to the source mode after failure', async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'filesystem-copy-mode-test-'))
  const sourcePath = path.join(temporaryDirectory, 'source')
  const destinationPath = path.join(temporaryDirectory, 'destination')
  await mkdir(sourcePath)
  await writeFile(path.join(sourcePath, 'file.txt'), 'source')
  await chmod(sourcePath, 0o500)
  mocks.pipeline.mockRejectedValueOnce(new Error('copy failed'))

  try {
    await expect(copyPath(sourcePath, destinationPath)).rejects.toThrow('copy failed')
    expect((await stat(destinationPath)).mode & 0o777).toBe(0o500)
  } finally {
    await chmod(sourcePath, 0o700)
    await chmod(destinationPath, 0o700).catch(() => {})
  }
})

test('reports both copy and permission restoration failures', async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'filesystem-copy-mode-failure-test-'))
  const sourcePath = path.join(temporaryDirectory, 'source')
  const destinationPath = path.join(temporaryDirectory, 'destination')
  await mkdir(sourcePath)
  await writeFile(path.join(sourcePath, 'file.txt'), 'source')
  mocks.pipeline.mockRejectedValueOnce(new Error('copy failed'))
  vi.spyOn(fs, 'chmod').mockRejectedValueOnce(new Error('chmod failed'))

  const copy = copyPath(sourcePath, destinationPath)
  await expect(copy).rejects.toThrow('copy failed; failed to restore destination permissions: chmod failed')
  await expect(copy).rejects.toBeInstanceOf(DestinationPermissionRestoreError)
})

test('uses a destination-relative absolute junction target for Windows directory links', async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'filesystem-copy-link-test-'))
  const sourceDirectory = path.join(temporaryDirectory, 'source')
  const destinationDirectory = path.join(temporaryDirectory, 'destination')
  const sourceTarget = path.join(sourceDirectory, 'target')
  const sourceLink = path.join(sourceDirectory, 'link')
  const destinationLink = path.join(destinationDirectory, 'link')
  await mkdir(sourceTarget, { recursive: true })
  await mkdir(destinationDirectory)
  await symlink('target', sourceLink, 'dir')
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  const symlinkSpy = vi.spyOn(fs, 'symlink').mockResolvedValue()

  await copyPath(sourceLink, destinationLink)

  expect(symlinkSpy).toHaveBeenCalledWith(path.join(destinationDirectory, 'target'), destinationLink, 'junction')
})

test('passes cancellation to the file-copy stream', async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'filesystem-copy-test-'))
  const sourcePath = path.join(temporaryDirectory, 'source.txt')
  const destinationPath = path.join(temporaryDirectory, 'destination.txt')
  await writeFile(sourcePath, 'source')
  const controller = new AbortController()

  mocks.pipeline.mockImplementationOnce(
    async (source: Readable, destination: Writable, options: { signal: AbortSignal }) => {
      expect(options).toEqual({ signal: controller.signal })
      source.destroy()
      destination.destroy()
      controller.abort()
      throw controller.signal.reason
    },
  )

  await expect(copyPath(sourcePath, destinationPath, { signal: controller.signal })).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(mocks.pipeline).toHaveBeenCalledOnce()
  await expect(stat(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' })
})

test.runIf(process.platform !== 'win32')('preserves sparse extents without overwriting destinations', async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'filesystem-copy-sparse-test-'))
  const sourcePath = path.join(temporaryDirectory, 'source.img')
  const destinationPath = path.join(temporaryDirectory, 'destination.img')
  const existingPath = path.join(temporaryDirectory, 'existing.img')
  await writeFile(sourcePath, '')
  await fs.truncate(sourcePath, SPARSE_TEST_FILE_SIZE)
  await writeFile(existingPath, 'keep')

  const sourceStat = await stat(sourcePath)
  expect(sourceStat.blocks * 512).toBeLessThan(sourceStat.size)

  await copyPath(sourcePath, destinationPath)

  const destinationStat = await stat(destinationPath)
  expect(destinationStat.size).toBe(sourceStat.size)
  expect(destinationStat.blocks * 512).toBeLessThan(destinationStat.size)
  expect(mocks.pipeline).not.toHaveBeenCalled()
  await expect(copyPath(sourcePath, existingPath)).rejects.toMatchObject({ code: 'EEXIST' })
  await expect(fs.readFile(existingPath, 'utf8')).resolves.toBe('keep')
})

test.runIf(process.platform !== 'win32')(
  'settles and removes a sparse copy when cancellation is observed',
  async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'filesystem-copy-sparse-cancel-test-'))
    const sourcePath = path.join(temporaryDirectory, 'source.img')
    const destinationPath = path.join(temporaryDirectory, 'destination.img')
    await writeFile(sourcePath, '')
    await fs.truncate(sourcePath, SPARSE_TEST_FILE_SIZE)
    const controller = new AbortController()
    const open = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementation(async (target, flags, mode) => {
      const handle = await open(target, flags, mode)
      if (flags === 'wx') controller.abort()
      return handle
    })

    await expect(copyPath(sourcePath, destinationPath, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })

    await expect(stat(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' })
  },
)

test('treats a created symlink as complete when cancellation arrives at its commit point', async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'filesystem-copy-symlink-cancel-test-'))
  const sourceTarget = path.join(temporaryDirectory, 'target.txt')
  const sourcePath = path.join(temporaryDirectory, 'source-link')
  const destinationPath = path.join(temporaryDirectory, 'destination-link')
  await writeFile(sourceTarget, 'target')
  await symlink(sourceTarget, sourcePath)
  const controller = new AbortController()
  const realSymlink = fs.symlink.bind(fs)
  vi.spyOn(fs, 'symlink').mockImplementation(async (...args) => {
    await realSymlink(...args)
    controller.abort()
  })

  await expect(copyPath(sourcePath, destinationPath, { signal: controller.signal })).resolves.toBeUndefined()
  await expect(fs.readlink(destinationPath)).resolves.toBe(sourceTarget)
})
