import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let tmp: string | null = null

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
  vi.resetModules()
  vi.doUnmock('electron')
  vi.doUnmock('write-file-atomic')
})

test('flushSettings drains writes queued during an in-flight flush', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  let settings!: typeof import('#/main/settings.ts')
  const writeFile = fs.writeFile.bind(fs)
  let writes = 0
  vi.doMock('write-file-atomic', () => ({
    default: async (...args: Parameters<typeof writeFile>) => {
      writes += 1
      if (writes === 1) await settings.setFetchInterval(300)
      return writeFile(...args)
    },
  }))
  settings = await import('#/main/settings.ts')

  await settings.setThemePref('dark')
  const flushed = await settings.flushSettings()
  expect(flushed).toBe(true)

  const saved = JSON.parse(readFileSync(path.join(tmp, 'settings.json'), 'utf-8')) as { fetchIntervalSec: number }
  expect(writes).toBe(2)
  expect(saved.fetchIntervalSec).toBe(300)
})

test('flushSettings reports earlier failures in a chained flush', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  let settings!: typeof import('#/main/settings.ts')
  const writeFile = fs.writeFile.bind(fs)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  let writes = 0
  vi.doMock('write-file-atomic', () => ({
    default: async (...args: Parameters<typeof writeFile>) => {
      writes += 1
      if (writes === 1) {
        await settings.setFetchInterval(301)
        throw new Error('disk full')
      }
      return writeFile(...args)
    },
  }))
  settings = await import('#/main/settings.ts')

  try {
    await settings.setThemePref('light')
    const flushed = await settings.flushSettings()
    expect(flushed).toBe(false)
  } finally {
    warn.mockRestore()
  }

  const saved = JSON.parse(readFileSync(path.join(tmp, 'settings.json'), 'utf-8')) as {
    theme: string
    fetchIntervalSec: number
  }
  expect(writes).toBe(2)
  expect(saved.theme).toBe('light')
  expect(saved.fetchIntervalSec).toBe(301)
})
