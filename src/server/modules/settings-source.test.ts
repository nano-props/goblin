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
    globalShortcut: 'CommandOrControl+Alt+G',
    terminalApp: 'ghostty',
    editorApp: 'cursor',
    lanEnabled: false,
  })
  await mod.setServerSessionState({
    ...defaultSessionState(),
    openRepos: [{ kind: 'local', id: '/repo-b' }],
    activeRepo: '/repo-b',
    selectedTerminalByWorktree: { '/repo-b\0/worktree': '/repo-b\0/worktree\0slot-2' },
    workspacePaneTabOrderByBranchByRepo: {
      '/repo-b': {
        main: [],
      },
    },
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
    globalShortcut: 'Alt+G',
    terminalApp: 'ghostty',
    editorApp: 'cursor',
    lanEnabled: false,
  })
  expect(await reloaded.getServerSessionState()).toMatchObject({
    openRepos: [{ kind: 'local', id: '/repo-b' }],
    activeRepo: '/repo-b',
    selectedTerminalByWorktree: { '/repo-b\0/worktree': '/repo-b\0/worktree\0slot-2' },
    workspacePaneTabOrderByBranchByRepo: {
      '/repo-b': {
        main: [],
      },
    },
  })
  expect(await reloaded.getServerRecentRepos()).toEqual([{ kind: 'local', id: '/repo-b' }])
})

test('normalizes branch-scoped workspace pane view preferences in server sessions', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  await mod.setServerSessionState({
    ...defaultSessionState(),
    openRepos: [
      { kind: 'local', id: '/repo-b' },
      { kind: 'local', id: '/repo-array' },
    ],
    activeRepo: '/repo-b',
    preferredWorkspacePaneViewByBranchByRepo: {
      '/repo-b': {
        main: 'history',
        changes: 'changes',
        terminal: 'terminal',
        'bad\0branch': 'changes',
        feature: 'not-a-pane-view',
      },
      '/repo-c': {
        main: 'terminal',
      },
      '/repo-array': ['history'],
    } as never,
    workspacePaneTabOrderByBranchByRepo: {
      '/repo-b': {
        main: [{ type: 'history', id: 'history' }],
        changes: [],
        terminal: [],
      },
    },
  })

  expect(await mod.getServerSessionState()).toMatchObject({
    preferredWorkspacePaneViewByBranchByRepo: {
      '/repo-b': {
        main: 'history',
        terminal: 'terminal',
      },
    },
  })
})

test('normalizes workspace pane tab order in server sessions', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  await mod.setServerSessionState({
    ...defaultSessionState(),
    openRepos: [
      { kind: 'local', id: '/repo-b' },
      { kind: 'local', id: '/repo-array' },
    ],
    activeRepo: '/repo-b',
    workspacePaneTabOrderByBranchByRepo: {
      '/repo-b': {
        main: [
          { type: 'status', id: 'status' },
          { type: 'terminal', id: 'slot-1' },
          { type: 'history', id: 'history' },
          { type: 'status', id: 'status' },
          { type: 'changes', id: 'changes' },
        ],
        empty: [],
        'bad\0branch': [{ type: 'status', id: 'status' }],
        invalid: [{ type: 'changes', id: 'status' }],
      },
      '/repo-c': {
        main: [{ type: 'status', id: 'status' }],
      },
      '/repo-array': [{ type: 'status', id: 'status' }],
    } as never,
  })

  expect(await mod.getServerSessionState()).toMatchObject({
    workspacePaneTabOrderByBranchByRepo: {
      '/repo-b': {
        main: [
          { type: 'status', id: 'status' },
          { type: 'terminal', id: 'slot-1' },
          { type: 'history', id: 'history' },
          { type: 'changes', id: 'changes' },
        ],
        empty: [],
        invalid: [],
      },
    },
  })
})
