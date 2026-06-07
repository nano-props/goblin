import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultSessionState } from '#/shared/settings-defaults.ts'

let tmp: string | null = null
let previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR

afterEach(async () => {
  const mod = await import('#/server/modules/settings-source.ts')
  mod.resetServerSettingsSourceForTests()
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
  if (previousDataDir === undefined) delete process.env.GOBLIN_SERVER_DATA_DIR
  else process.env.GOBLIN_SERVER_DATA_DIR = previousDataDir
  vi.resetModules()
})

test('initializes server-settings.json with defaults when no persisted settings exist', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  const sec = await mod.getServerFetchIntervalSec()

  expect(sec).toBe(120)
  expect(await mod.getServerSettingsPrefs()).toMatchObject({
    lang: 'auto',
    theme: 'auto',
    colorTheme: 'macos',
    terminalNotificationsEnabled: false,
    shortcutsDisabled: false,
    globalShortcutDisabled: false,
    swapCloseShortcuts: false,
    toggleDetailOnActionBarBlankClick: false,
    globalShortcut: 'Alt+G',
    terminalApp: 'auto',
    editorApp: 'auto',
    lanEnabled: false,
  })
  expect(await mod.getServerSessionState()).toMatchObject({
    openRepos: [],
    activeRepo: null,
  })
  expect(await mod.getServerRecentRepos()).toEqual([])
  mod.resetServerSettingsSourceForTests()
  vi.resetModules()
  const reloaded = await import('#/server/modules/settings-source.ts')
  expect(await reloaded.getServerFetchIntervalSec()).toBe(120)
})

test('persists updates and notifies subscribers from the server settings store', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  const listener = vi.fn()
  const unsubscribe = mod.subscribeServerFetchInterval(listener)

  const sec = await mod.setServerFetchIntervalSec(42)
  await mod.updateServerSettingsPrefs({
    lang: 'ko',
    theme: 'dark',
    colorTheme: 'github',
    terminalNotificationsEnabled: true,
    shortcutsDisabled: true,
    globalShortcutDisabled: true,
    swapCloseShortcuts: true,
    toggleDetailOnActionBarBlankClick: true,
    globalShortcut: 'CommandOrControl+Alt+G',
    terminalApp: 'ghostty',
    editorApp: 'cursor',
    lanEnabled: false,
  })
  await mod.setServerSessionState({
    ...defaultSessionState(),
    openRepos: [{ kind: 'local', id: '/repo-b' }],
    activeRepo: '/repo-b',
    selectedTerminalByWorktree: { '/repo-b\0/worktree': '/repo-b\0/worktree\0terminal-2' },
  })
  await mod.addServerRecentRepo({ kind: 'local', id: '/repo-b' })
  unsubscribe()

  expect(sec).toBe(42)
  expect(listener).toHaveBeenCalledWith(42)
  mod.resetServerSettingsSourceForTests()
  vi.resetModules()
  const reloaded = await import('#/server/modules/settings-source.ts')
  expect(await reloaded.getServerFetchIntervalSec()).toBe(42)
  expect(await reloaded.getServerSettingsPrefs()).toMatchObject({
    lang: 'ko',
    theme: 'dark',
    colorTheme: 'github',
    terminalNotificationsEnabled: true,
    shortcutsDisabled: true,
    globalShortcutDisabled: true,
    swapCloseShortcuts: true,
    toggleDetailOnActionBarBlankClick: true,
    globalShortcut: 'Alt+G',
    terminalApp: 'ghostty',
    editorApp: 'cursor',
    lanEnabled: false,
  })
  expect(await reloaded.getServerSessionState()).toMatchObject({
    openRepos: [{ kind: 'local', id: '/repo-b' }],
    activeRepo: '/repo-b',
    selectedTerminalByWorktree: { '/repo-b\0/worktree': '/repo-b\0/worktree\0terminal-2' },
  })
  expect(await reloaded.getServerRecentRepos()).toEqual([{ kind: 'local', id: '/repo-b' }])
})
