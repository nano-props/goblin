import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

const execaMock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({
  execa: execaMock,
}))

const { openInFinder } = await import('#/system/finder.ts')

const originalPlatform = process.platform
const tempDirs: string[] = []

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    return run()
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  }
}

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'goblin-finder-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  execaMock.mockReset()
})

describe('openInFinder', () => {
  test('is unavailable outside macOS', async () => {
    await withPlatform('linux', async () => {
      const result = await openInFinder('/tmp')
      expect(result).toEqual({ ok: false, message: 'error.finder-not-available' })
      expect(execaMock).not.toHaveBeenCalled()
    })
  })

  test('rejects invalid paths before spawning Finder', async () => {
    await withPlatform('darwin', async () => {
      const result = await openInFinder('relative/path')
      expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
      expect(execaMock).not.toHaveBeenCalled()
    })
  })

  test('opens an existing directory with Launch Services', async () => {
    await withPlatform('darwin', async () => {
      const dir = makeTempDir()
      execaMock.mockResolvedValue({ stdout: '' })

      const result = await openInFinder(dir)

      expect(result).toEqual({ ok: true, message: dir })
      expect(execaMock).toHaveBeenCalledWith(
        'open',
        [dir],
        expect.objectContaining({ timeout: 10_000, forceKillAfterDelay: 500 }),
      )
    })
  })

  test('returns the spawn error message', async () => {
    await withPlatform('darwin', async () => {
      const dir = makeTempDir()
      execaMock.mockRejectedValue(new Error('launch services failed'))

      await expect(openInFinder(dir)).resolves.toEqual({ ok: false, message: 'launch services failed' })
    })
  })
})
