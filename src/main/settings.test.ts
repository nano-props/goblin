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

test('defaults auto-fetch to two minutes', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const settings = await import('#/main/settings.ts')

  const loaded = await settings.loadSettings()

  expect(loaded.fetchIntervalSec).toBe(120)
})

test('defaults action bar blank click detail toggle to disabled', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const settings = await import('#/main/settings.ts')

  const loaded = await settings.loadSettings()

  expect(loaded.toggleDetailOnActionBarBlankClick).toBe(false)
})

test('defaults terminal bell notifications to disabled', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const settings = await import('#/main/settings.ts')

  const loaded = await settings.loadSettings()

  expect(loaded.terminalNotificationsEnabled).toBe(false)
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

test('persists the selected color theme', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const settings = await import('#/main/settings.ts')

  await settings.setColorTheme('shadcn')
  const flushed = await settings.flushSettings()
  expect(flushed).toBe(true)

  const saved = JSON.parse(readFileSync(path.join(tmp, 'settings.json'), 'utf-8')) as { colorTheme: string }
  expect(saved.colorTheme).toBe('shadcn')
})

test('persists action bar blank click detail toggle', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const settings = await import('#/main/settings.ts')

  await settings.setToggleDetailOnActionBarBlankClick(true)
  const flushed = await settings.flushSettings()
  expect(flushed).toBe(true)

  const saved = JSON.parse(readFileSync(path.join(tmp, 'settings.json'), 'utf-8')) as {
    toggleDetailOnActionBarBlankClick: boolean
  }
  expect(saved.toggleDetailOnActionBarBlankClick).toBe(true)
})

test('persists terminal bell notifications toggle', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const settings = await import('#/main/settings.ts')

  await settings.setTerminalNotificationsEnabled(true)
  const flushed = await settings.flushSettings()
  expect(flushed).toBe(true)

  const saved = JSON.parse(readFileSync(path.join(tmp, 'settings.json'), 'utf-8')) as {
    terminalNotificationsEnabled: boolean
  }
  expect(saved.terminalNotificationsEnabled).toBe(true)
})

test('persists session detail focus mode', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const settings = await import('#/main/settings.ts')

  await settings.setSession({
    openRepos: [],
    activeRepo: null,
    detailCollapsed: true,
    detailFocusMode: true,
    workspaceLayout: 'top-bottom',
    detailPaneSizes: { 'top-bottom': 50, 'left-right': 60 },
  })
  const flushed = await settings.flushSettings()
  expect(flushed).toBe(true)

  const saved = JSON.parse(readFileSync(path.join(tmp, 'settings.json'), 'utf-8')) as {
    session: { detailFocusMode: boolean }
  }
  expect(saved.session.detailFocusMode).toBe(true)
})

test('adds opened repos to the OS recent documents list', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  const addRecentDocument = vi.fn()
  vi.doMock('electron', () => ({
    app: {
      getPath: () => tmp!,
      addRecentDocument,
      clearRecentDocuments: vi.fn(),
    },
  }))
  const settings = await import('#/main/settings.ts')

  await settings.addRecentRepo('/tmp/repo')

  expect(addRecentDocument).toHaveBeenCalledWith('/tmp/repo')
})

test('clears OS recent documents when recent repos are cleared', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  const clearRecentDocuments = vi.fn()
  vi.doMock('electron', () => ({
    app: {
      getPath: () => tmp!,
      addRecentDocument: vi.fn(),
      clearRecentDocuments,
    },
  }))
  const settings = await import('#/main/settings.ts')

  await settings.addRecentRepo('/tmp/repo')
  await settings.clearRecentRepos()

  expect(clearRecentDocuments).toHaveBeenCalledTimes(1)
})
