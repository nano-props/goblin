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

import { copyPath } from '#/system/filesystem-copy.ts'

let temporaryDirectory: string | null = null

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
