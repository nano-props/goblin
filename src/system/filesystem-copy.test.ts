import os from 'node:os'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
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
