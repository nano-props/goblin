import { afterEach, expect, test, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'
import { WORKSPACE_PANE_STATIC_TAB_IDS, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { restorableWorkspacePaneTargetKey } from '#/shared/workspace-pane-tabs-target.ts'
import { formatWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneDurableLayout } from '#/shared/workspace-pane-tabs.ts'
import type { WorkspacePaneLayoutRepository } from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

let tmp: string | null = null
let previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
const REPO_A = workspaceIdForTest('goblin+file:///repo-a')
const REPO_B = workspaceIdForTest('goblin+file:///repo-b')
const REPO_C = workspaceIdForTest('goblin+file:///repo-c')
const RUNTIME_USER_ID = 'settings-source-runtime-user'

async function writeWorkspacePaneLayout(
  source: { serverWorkspacePaneLayoutRepository: WorkspacePaneLayoutRepository },
  workspaceId: WorkspaceId,
  replacement: WorkspacePaneDurableLayout,
): Promise<void> {
  const current = await source.serverWorkspacePaneLayoutRepository.load(workspaceId)
  const outcome = await source.serverWorkspacePaneLayoutRepository.compareAndSwap({
    workspaceId,
    expected: current.layout,
    replacement,
  })
  if (outcome.kind !== 'accepted') throw new Error('test workspace pane layout CAS failed')
}

afterEach(async () => {
  const mod = await import('#/server/modules/settings-source.ts')
  mod.resetServerSettingsSourceForTests()
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
  if (previousDataDir === undefined) delete process.env.GOBLIN_SERVER_DATA_DIR
  else process.env.GOBLIN_SERVER_DATA_DIR = previousDataDir
  vi.resetModules()
})

test('initializes user-settings.json with defaults when no persisted settings exist', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  const sec = await mod.getServerFetchIntervalSec()

  expect(sec).toBe(120)
  expect(await mod.getUserSettings()).toMatchObject({
    lang: 'auto',
    theme: 'auto',
    colorTheme: 'macos',
    terminalNotificationsEnabled: false,
    shortcutsDisabled: false,
    globalShortcutDisabled: false,
    globalShortcut: 'Alt+G',
    lanEnabled: false,
  })
  expect(await mod.getServerWorkspaceState()).toEqual(defaultServerWorkspaceState())
  expect(await mod.getServerRecentWorkspaces()).toEqual([])
  expect(await mod.getServerWorkspaceSettings()).toEqual([])
  mod.resetServerSettingsSourceForTests()
  vi.resetModules()
  const reloaded = await import('#/server/modules/settings-source.ts')
  expect(await reloaded.getServerFetchIntervalSec()).toBe(120)
})

test('persists updates and notifies subscribers from the server settings store', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  const listener = vi.fn()
  const unsubscribe = mod.subscribeServerFetchInterval(listener)

  const sec = await mod.setServerFetchIntervalSec(42)
  await mod.updateUserSettings({
    lang: 'ko',
    theme: 'dark',
    colorTheme: 'github',
    terminalNotificationsEnabled: true,
    shortcutsDisabled: true,
    globalShortcutDisabled: true,
    globalShortcut: 'Alt+K',
    lanEnabled: false,
  })
  await writeWorkspacePaneLayout(mod, REPO_B, {
    entries: [{ target: { kind: 'git-branch', branch: 'main' }, tabs: [] }],
  })
  await mod.addServerRecentWorkspace({ id: REPO_B })
  await mod.trustServerWorkspaceWorktreeBootstrapConfig({
    workspaceId: REPO_B,
    configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  })
  unsubscribe()

  expect(sec).toBe(42)
  expect(listener).toHaveBeenCalledWith(42)
  expect(listener).toHaveBeenCalledTimes(1)
  mod.resetServerSettingsSourceForTests()
  vi.resetModules()
  const reloaded = await import('#/server/modules/settings-source.ts')
  expect(await reloaded.getServerFetchIntervalSec()).toBe(42)
  expect(await reloaded.getUserSettings()).toMatchObject({
    lang: 'ko',
    theme: 'dark',
    colorTheme: 'github',
    terminalNotificationsEnabled: true,
    shortcutsDisabled: true,
    globalShortcutDisabled: true,
    globalShortcut: 'Alt+K',
    lanEnabled: false,
  })
  expect(await reloaded.getServerWorkspaceState()).toMatchObject({
    workspacePaneTabsByTargetByWorkspace: {
      [REPO_B]: {
        [branchTargetKey(REPO_B, 'main')]: [],
      },
    },
  })
  expect(await reloaded.getServerRecentWorkspaces()).toEqual([{ id: REPO_B }])
  expect(await reloaded.getServerWorkspaceSettings()).toEqual([
    {
      workspaceId: REPO_B,
      worktreeBootstrapTrust: {
        configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        trustedAt: expect.any(String),
      },
    },
  ])
})

test('rejects an invalid global shortcut without resetting persisted settings', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  await mod.updateUserSettings({ globalShortcut: 'Alt+K' })
  await expect(mod.updateUserSettings({ globalShortcut: 'Control+O' })).rejects.toThrow('invalid global shortcut')
  expect((await mod.getUserSettings()).globalShortcut).toBe('Alt+K')
})

test.each([
  [{ lang: 'fr' }, 'invalid language'],
  [{ theme: 'sepia' }, 'invalid theme'],
  [{ colorTheme: 'unknown' }, 'invalid color theme'],
  [{ fetchIntervalSec: 1.5 }, 'invalid fetch interval'],
  [{ fetchIntervalSec: 3601 }, 'invalid fetch interval'],
  [{ terminalNotificationsEnabled: 'yes' }, 'invalid terminal notifications setting'],
  [{ shortcutsDisabled: 1 }, 'invalid shortcuts setting'],
  [{ globalShortcutDisabled: null }, 'invalid global shortcut disabled setting'],
  [{ lanEnabled: 'true' }, 'invalid LAN setting'],
] as const)('rejects invalid direct settings patch %j without mutation', async (patch, message) => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  const before = await mod.getUserSettings()

  await expect(Reflect.apply(mod.updateUserSettings, undefined, [patch])).rejects.toThrow(message)
  expect(await mod.getUserSettings()).toEqual(before)
})

test.each([-1, 1.5, 3601, Number.NaN])('rejects invalid direct fetch interval %s without mutation', async (sec) => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  const before = await mod.getServerFetchIntervalSec()

  await expect(Reflect.apply(mod.setServerFetchIntervalSec, undefined, [sec])).rejects.toThrow('invalid fetch interval')
  expect(await mod.getServerFetchIntervalSec()).toBe(before)
})

test('leaves corrupt settings JSON in place and fails every read', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  await writeFile(path.join(tmp, 'user-settings.json'), '{bad json', 'utf-8')

  const mod = await import('#/server/modules/settings-source.ts')

  await expect(mod.getServerFetchIntervalSec()).rejects.toThrow()
  await expect(mod.getServerFetchIntervalSec()).rejects.toThrow()
  expect(await readFile(path.join(tmp, 'user-settings.json'), 'utf-8')).toBe('{bad json')
  expect(readdirSync(tmp)).toEqual(['user-settings.json'])
})

test('leaves a structurally corrupt settings root in place and fails every read', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  await writeFile(path.join(tmp, 'user-settings.json'), JSON.stringify([]), 'utf-8')

  const mod = await import('#/server/modules/settings-source.ts')

  await expect(mod.getServerFetchIntervalSec()).rejects.toThrow('settings root must be an object')
  await expect(mod.getServerFetchIntervalSec()).rejects.toThrow('settings root must be an object')
  expect(JSON.parse(await readFile(path.join(tmp, 'user-settings.json'), 'utf-8'))).toEqual([])
  expect(readdirSync(tmp)).toEqual(['user-settings.json'])
})

test('does not confuse a persisted JSON null with missing settings', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const file = path.join(tmp, 'user-settings.json')
  await writeFile(file, 'null', 'utf-8')

  const mod = await import('#/server/modules/settings-source.ts')

  await expect(mod.getUserSettings()).rejects.toThrow('settings root must be an object')
  await expect(mod.getUserSettings()).rejects.toThrow('settings root must be an object')
  expect(await readFile(file, 'utf-8')).toBe('null')
  expect(readdirSync(tmp)).toEqual(['user-settings.json'])
})

test('leaves invalid current-version settings fields in place and fails every read', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  await writeFile(path.join(tmp, 'user-settings.json'), JSON.stringify({ version: 1, theme: 'bogus' }), 'utf-8')

  const mod = await import('#/server/modules/settings-source.ts')
  await expect(mod.getUserSettings()).rejects.toThrow('invalid current settings shape')
  await expect(mod.getUserSettings()).rejects.toThrow('invalid current settings shape')
  expect(JSON.parse(await readFile(path.join(tmp, 'user-settings.json'), 'utf-8'))).toEqual({
    version: 1,
    theme: 'bogus',
  })
  expect(readdirSync(tmp)).toEqual(['user-settings.json'])
})

test('fails closed without moving or overwriting settings from a newer version', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const newer = { version: 2, theme: 'dark', futureSetting: true }
  await writeFile(path.join(tmp, 'user-settings.json'), JSON.stringify(newer), 'utf-8')

  const mod = await import('#/server/modules/settings-source.ts')

  await expect(mod.getUserSettings()).rejects.toThrow('unsupported settings version: 2')
  expect(JSON.parse(await readFile(path.join(tmp, 'user-settings.json'), 'utf-8'))).toEqual(newer)
  expect(readdirSync(tmp)).toEqual(['user-settings.json'])
})

test('fails closed without moving or overwriting unversioned settings', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  await writeFile(path.join(tmp, 'user-settings.json'), JSON.stringify({ theme: 'bogus' }), 'utf-8')

  const mod = await import('#/server/modules/settings-source.ts')

  await expect(mod.getUserSettings()).rejects.toThrow('unsupported settings version: undefined')
  expect(JSON.parse(await readFile(path.join(tmp, 'user-settings.json'), 'utf-8'))).toEqual({ theme: 'bogus' })
  expect(readdirSync(tmp)).toEqual(['user-settings.json'])
})

test('does not decode unversioned durable settings', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const oversizedEntry = { id: `goblin+file:///${'a'.repeat(4096)}` }
  await writeFile(
    path.join(tmp, 'user-settings.json'),
    JSON.stringify({
      workspace: { openWorkspaceEntries: [oversizedEntry] },
      recentWorkspaces: [oversizedEntry],
    }),
    'utf-8',
  )

  const mod = await import('#/server/modules/settings-source.ts')
  await expect(mod.getServerWorkspaceState()).rejects.toThrow('unsupported settings version: undefined')
})

test('fails fast when the settings file cannot be read', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  await mkdir(path.join(tmp, 'user-settings.json'))

  const mod = await import('#/server/modules/settings-source.ts')
  await expect(mod.getServerWorkspaceState()).rejects.toMatchObject({ code: 'EISDIR' })
  expect(readdirSync(tmp)).toEqual(['user-settings.json'])
})

test('serializes concurrent settings mutations without dropping updates', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')

  await Promise.all([
    mod.addServerRecentWorkspace({ id: REPO_A }),
    mod.addServerRecentWorkspace({ id: REPO_B }),
    mod.addServerRecentWorkspace({ id: REPO_C }),
  ])

  expect(await mod.getServerRecentWorkspaces()).toEqual([
    { id: REPO_C },
    { id: REPO_B },
    { id: REPO_A },
  ])
  expect(existsSync(path.join(tmp, 'user-settings.json'))).toBe(true)
})

test('stores the shared open repo order without applying the recent-workspace limit', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  const entries = Array.from({ length: 12 }, (_, index) => ({
    id: workspaceIdForTest(`goblin+file:///repo-${index}`),
  }))

  for (const entry of entries) await mod.addServerWorkspaceEntry(entry)
  await mod.addServerWorkspaceEntry(entries[3]!)

  expect((await mod.getServerWorkspaceState()).openWorkspaceEntries).toEqual(entries)
})

test('invalidates runtime epochs only inside a committed workspace removal transition', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const source = await import('#/server/modules/settings-source.ts')
  const runtimes = await import('#/server/modules/workspace-runtimes.ts')
  runtimes.clearWorkspaceRuntimesForUser(RUNTIME_USER_ID)
  try {
    const initialRuntimeId = runtimes.acquireWorkspaceRuntime(RUNTIME_USER_ID, REPO_A, 'client-initial')

    await source.removeServerWorkspaceEntry(REPO_A)
    expect(runtimes.isCurrentWorkspaceRuntime(RUNTIME_USER_ID, REPO_A, initialRuntimeId)).toBe(true)

    await source.addServerWorkspaceEntry({ id: REPO_A })
    await source.removeServerWorkspaceEntry(REPO_A)
    expect(runtimes.isCurrentWorkspaceRuntime(RUNTIME_USER_ID, REPO_A, initialRuntimeId)).toBe(false)

    await source.addServerWorkspaceEntry({ id: REPO_A })
    const reopenedRuntimeId = runtimes.acquireWorkspaceRuntime(RUNTIME_USER_ID, REPO_A, 'client-reopened')
    expect(reopenedRuntimeId).not.toBe(initialRuntimeId)
    expect(runtimes.isCurrentWorkspaceRuntime(RUNTIME_USER_ID, REPO_A, reopenedRuntimeId)).toBe(true)
  } finally {
    runtimes.clearWorkspaceRuntimesForUser(RUNTIME_USER_ID)
  }
})

test('preserves runtime epochs when durable workspace removal fails to persist', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const source = await import('#/server/modules/settings-source.ts')
  const runtimes = await import('#/server/modules/workspace-runtimes.ts')
  runtimes.clearWorkspaceRuntimesForUser(RUNTIME_USER_ID)
  try {
    await source.addServerWorkspaceEntry({ id: REPO_A })
    const runtimeId = runtimes.acquireWorkspaceRuntime(RUNTIME_USER_ID, REPO_A, 'client-write-failure')
    const settingsFile = path.join(tmp, 'user-settings.json')
    rmSync(settingsFile)
    await mkdir(settingsFile)

    await expect(source.removeServerWorkspaceEntry(REPO_A)).rejects.toMatchObject({
      name: 'SettingsPersistenceWriteError',
    })
    expect(runtimes.isCurrentWorkspaceRuntime(RUNTIME_USER_ID, REPO_A, runtimeId)).toBe(true)
  } finally {
    runtimes.clearWorkspaceRuntimesForUser(RUNTIME_USER_ID)
  }
})

test('repairs open repos only when the source membership is unchanged', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  const repoA = { id: REPO_A }
  const repoB = { id: REPO_B }
  const repoC = { id: REPO_C }
  await mod.addServerWorkspaceEntry(repoA)
  await mod.addServerWorkspaceEntry(repoB)
  const runtimes = await import('#/server/modules/workspace-runtimes.ts')
  runtimes.clearWorkspaceRuntimesForUser(RUNTIME_USER_ID)
  try {
    const runtimeA = runtimes.acquireWorkspaceRuntime(RUNTIME_USER_ID, REPO_A, 'client-a')
    const runtimeB = runtimes.acquireWorkspaceRuntime(RUNTIME_USER_ID, REPO_B, 'client-b')
    runtimes.retainWorkspaceRuntimeResource(RUNTIME_USER_ID, REPO_B, runtimeB, 'terminal-b')

    await expect(mod.compareAndReplaceServerWorkspaceEntries([repoA, repoB], [repoA])).resolves.toMatchObject({
      matched: true,
      workspace: { openWorkspaceEntries: [repoA] },
    })
    expect(runtimes.isCurrentWorkspaceRuntime(RUNTIME_USER_ID, REPO_A, runtimeA)).toBe(true)
    expect(runtimes.isCurrentWorkspaceRuntime(RUNTIME_USER_ID, REPO_B, runtimeB)).toBe(false)

    await mod.addServerWorkspaceEntry(repoC)
    const runtimeC = runtimes.acquireWorkspaceRuntime(RUNTIME_USER_ID, REPO_C, 'client-c')
    await expect(mod.compareAndReplaceServerWorkspaceEntries([repoA], [])).resolves.toMatchObject({
      matched: false,
      latestWorkspace: { openWorkspaceEntries: [repoA, repoC] },
    })
    expect(runtimes.isCurrentWorkspaceRuntime(RUNTIME_USER_ID, REPO_A, runtimeA)).toBe(true)
    expect(runtimes.isCurrentWorkspaceRuntime(RUNTIME_USER_ID, REPO_C, runtimeC)).toBe(true)
  } finally {
    runtimes.clearWorkspaceRuntimesForUser(RUNTIME_USER_ID)
  }
})

test('does not invalidate runtimes when durable workspace membership is only reordered', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const source = await import('#/server/modules/settings-source.ts')
  const runtimes = await import('#/server/modules/workspace-runtimes.ts')
  const repoA = { id: REPO_A }
  const repoB = { id: REPO_B }
  await source.addServerWorkspaceEntry(repoA)
  await source.addServerWorkspaceEntry(repoB)
  runtimes.clearWorkspaceRuntimesForUser(RUNTIME_USER_ID)
  try {
    const runtimeA = runtimes.acquireWorkspaceRuntime(RUNTIME_USER_ID, REPO_A, 'client-a')
    const runtimeB = runtimes.acquireWorkspaceRuntime(RUNTIME_USER_ID, REPO_B, 'client-b')

    await expect(source.compareAndReplaceServerWorkspaceEntries([repoA, repoB], [repoB, repoA])).resolves.toMatchObject({
      matched: true,
      workspace: { openWorkspaceEntries: [repoB, repoA] },
    })
    expect(runtimes.isCurrentWorkspaceRuntime(RUNTIME_USER_ID, REPO_A, runtimeA)).toBe(true)
    expect(runtimes.isCurrentWorkspaceRuntime(RUNTIME_USER_ID, REPO_B, runtimeB)).toBe(true)
  } finally {
    runtimes.clearWorkspaceRuntimesForUser(RUNTIME_USER_ID)
  }
})

test('confirms one canonical workspace repo entry without writing settings', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  const entry = { id: REPO_A }
  await mod.addServerWorkspaceEntry(entry)

  await expect(mod.confirmServerWorkspaceEntry(entry)).resolves.toMatchObject({ matched: true })
  await mod.removeServerWorkspaceEntry(entry.id)
  await expect(mod.confirmServerWorkspaceEntry(entry)).resolves.toMatchObject({
    matched: false,
    latestWorkspace: { openWorkspaceEntries: [] },
  })
})

test('persists durable tabs independently of runtime membership', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  await writeWorkspacePaneLayout(mod, REPO_A, {
    entries: [
      {
        target: { kind: 'git-branch', branch: 'main' },
        tabs: [workspacePaneStaticTabEntry('history')],
      },
    ],
  })

  await expect(mod.getServerWorkspaceState()).resolves.toMatchObject({
    workspacePaneTabsByTargetByWorkspace: {
      [REPO_A]: { [branchTargetKey(REPO_A, 'main')]: [workspacePaneStaticTabEntry('history')] },
    },
  })
  mod.resetServerSettingsSourceForTests()
  vi.resetModules()
  const reloaded = await import('#/server/modules/settings-source.ts')
  await expect(reloaded.getServerWorkspaceState()).resolves.toMatchObject({
    workspacePaneTabsByTargetByWorkspace: {
      [REPO_A]: { [branchTargetKey(REPO_A, 'main')]: [workspacePaneStaticTabEntry('history')] },
    },
  })
})

test('workspace pane layout repository loads and applies normalized CAS outcomes', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  const repoEntry = { id: REPO_A }
  const empty = { entries: [] }
  const history: WorkspacePaneDurableLayout = {
    entries: [
      {
        target: { kind: 'git-branch', branch: 'main' },
        tabs: [workspacePaneStaticTabEntry('history')],
      },
    ],
  }
  const historyTarget = history.entries[0]
  if (!historyTarget) throw new Error('test layout target missing')
  await mod.addServerWorkspaceEntry(repoEntry)

  await expect(mod.serverWorkspacePaneLayoutRepository.load(REPO_A)).resolves.toEqual({ layout: empty })
  await mod.serverWorkspacePaneLayoutRepository.compareAndSwap({
    workspaceId: REPO_A,
    expected: empty,
    replacement: history,
  })
  await expect(
    mod.serverWorkspacePaneLayoutRestoreTransaction.validateMembershipAndLoad({
      workspaceId: REPO_A,
      expectedWorkspaceEntry: repoEntry,
    }),
  ).resolves.toMatchObject({ kind: 'accepted', snapshot: { layout: history } })
  await expect(
    mod.serverWorkspacePaneLayoutRepository.compareAndSwap({
      workspaceId: REPO_A,
      expected: history,
      replacement: history,
    }),
  ).resolves.toMatchObject({ kind: 'accepted', changed: false })
  await expect(
    mod.serverWorkspacePaneLayoutRepository.compareAndSwap({
      workspaceId: REPO_A,
      expected: empty,
      replacement: empty,
    }),
  ).resolves.toMatchObject({ kind: 'conflict', snapshot: { layout: history } })

  await mod.removeServerWorkspaceEntry(REPO_A)
  await expect(
    mod.serverWorkspacePaneLayoutRestoreTransaction.validateMembershipAndLoad({
      workspaceId: REPO_A,
      expectedWorkspaceEntry: repoEntry,
    }),
  ).resolves.toMatchObject({ kind: 'membership-conflict', snapshot: { layout: history } })
})

test('workspace pane layout repository does not disguise programming errors as persistence failures', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  const programmingError = new Error('invalid repository callback state')
  const replacement = Object.defineProperty({}, 'entries', {
    get() {
      throw programmingError
    },
  }) as WorkspacePaneDurableLayout

  await expect(
    mod.serverWorkspacePaneLayoutRepository.compareAndSwap({
      workspaceId: REPO_A,
      expected: { entries: [] },
      replacement,
    }),
  ).rejects.toBe(programmingError)
})

test('workspace pane layout repository classifies settings write failures at the persistence boundary', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  await mod.serverWorkspacePaneLayoutRepository.load(REPO_A)
  const settingsFile = path.join(tmp, 'user-settings.json')
  rmSync(settingsFile)
  await mkdir(settingsFile)

  await expect(
    mod.serverWorkspacePaneLayoutRepository.compareAndSwap({
      workspaceId: REPO_A,
      expected: { entries: [] },
      replacement: {
        entries: [
          {
            target: { kind: 'git-branch', branch: 'main' },
            tabs: [workspacePaneStaticTabEntry('history')],
          },
        ],
      },
    }),
  ).resolves.toMatchObject({ kind: 'write-failure', error: { name: 'SettingsPersistenceWriteError' } })
})

test('workspace pane restore does not write or classify persistence failures', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  const repoEntry = { id: REPO_A }
  const staleLayout: WorkspacePaneDurableLayout = {
    entries: [
      {
        target: { kind: 'git-branch', branch: 'deleted' },
        tabs: [workspacePaneStaticTabEntry('history')],
      },
    ],
  }
  await mod.addServerWorkspaceEntry(repoEntry)
  await writeWorkspacePaneLayout(mod, REPO_A, staleLayout)
  const settingsFile = path.join(tmp, 'user-settings.json')
  await expect(
    mod.serverWorkspacePaneLayoutRestoreTransaction.validateMembershipAndLoad({
      workspaceId: REPO_A,
      expectedWorkspaceEntry: repoEntry,
    }),
  ).resolves.toMatchObject({ kind: 'accepted', snapshot: { layout: staleLayout } })
})

test('updates workspace-level worktree bootstrap trust by repo id', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')

  await mod.trustServerWorkspaceWorktreeBootstrapConfig({
    workspaceId: REPO_A,
    configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  })
  await mod.trustServerWorkspaceWorktreeBootstrapConfig({
    workspaceId: REPO_A,
    configHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  })
  await mod.trustServerWorkspaceWorktreeBootstrapConfig({
    workspaceId: REPO_B,
    configHash: 'not-a-hash',
  })

  expect(await mod.getServerWorkspaceSettings()).toEqual([
    {
      workspaceId: REPO_A,
      worktreeBootstrapTrust: {
        configHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        trustedAt: expect.any(String),
      },
    },
  ])
})

test('clears workspace-level worktree bootstrap trust without dropping other workspace settings', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

  await mod.trustServerWorkspaceWorktreeBootstrapConfig({
    workspaceId: REPO_A,
    configHash,
  })
  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    targetKey: externalAppTargetKey('/repo-a-worktree'),
    itemId: 'editor:vscode',
  })

  await expect(
    mod.untrustServerWorkspaceWorktreeBootstrapConfig({
      workspaceId: REPO_A,
      configHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    }),
  ).resolves.toBe(false)
  await expect(mod.untrustServerWorkspaceWorktreeBootstrapConfig({ workspaceId: REPO_A, configHash })).resolves.toBe(
    true,
  )

  expect(await mod.getServerWorkspaceSettings()).toEqual([
    {
      workspaceId: REPO_A,
      workspaceExternalAppRecent: { byTarget: { [externalAppTargetKey('/repo-a-worktree')]: 'editor:vscode' } },
    },
  ])
})

test('clears empty workspace settings entry when removing only worktree bootstrap trust', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

  await mod.trustServerWorkspaceWorktreeBootstrapConfig({
    workspaceId: REPO_A,
    configHash,
  })

  await expect(mod.untrustServerWorkspaceWorktreeBootstrapConfig({ workspaceId: REPO_A, configHash })).resolves.toBe(
    true,
  )
  expect(await mod.getServerWorkspaceSettings()).toEqual([])
})

test('normalizes workspace pane tab list in server sessions', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  const mainTargetKey = branchTargetKey(REPO_B, 'main')
  const worktreeTargetKeyValue = worktreeTargetKey('/tmp/repo-b-worktree')
  const emptyTargetKey = branchTargetKey(REPO_B, 'empty')
  const invalidTargetKey = branchTargetKey(REPO_B, 'invalid')
  await writeWorkspacePaneLayout(mod, REPO_B, {
    entries: [
      {
        target: { kind: 'git-branch', branch: 'main' },
        tabs: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneStaticTabEntry('history'),
          workspacePaneStaticTabEntry('status'),
          workspacePaneStaticTabEntry('changes'),
        ],
      },
      {
        target: { kind: 'git-worktree', root: requiredFileWorkspaceLocator('/tmp/repo-b-worktree') },
        tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('changes')],
      },
      { target: { kind: 'git-branch', branch: 'empty' }, tabs: [] },
      {
        target: { kind: 'git-branch', branch: 'invalid' },
        tabs: [{ type: 'changes', tabId: WORKSPACE_PANE_STATIC_TAB_IDS.status }],
      },
    ] as never,
  })

  expect(await mod.getServerWorkspaceState()).toMatchObject({
    workspacePaneTabsByTargetByWorkspace: {
      [REPO_B]: {
        [mainTargetKey]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
        [worktreeTargetKeyValue]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('changes')],
        [emptyTargetKey]: [],
        [invalidTargetKey]: [],
      },
    },
  })
})

test('records the most recent workspace external app per canonical filesystem target', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')

  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    targetKey: externalAppTargetKey('/repo-a/worktree-x'),
    itemId: 'editor:vscode',
  })
  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    targetKey: externalAppTargetKey('/repo-a/worktree-y'),
    itemId: 'terminal:ghostty',
  })
  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    targetKey: 'workspace-root',
    itemId: 'finder',
  })

  expect(await mod.getServerWorkspaceSettings()).toEqual([
    {
      workspaceId: REPO_A,
      workspaceExternalAppRecent: {
        byTarget: {
          [externalAppTargetKey('/repo-a/worktree-x')]: 'editor:vscode',
          [externalAppTargetKey('/repo-a/worktree-y')]: 'terminal:ghostty',
          'workspace-root': 'finder',
        },
      },
    },
  ])

  mod.resetServerSettingsSourceForTests()
  vi.resetModules()
  const reloaded = await import('#/server/modules/settings-source.ts')
  expect(await reloaded.getServerWorkspaceSettings()).toEqual([
    {
      workspaceId: REPO_A,
      workspaceExternalAppRecent: {
        byTarget: {
          [externalAppTargetKey('/repo-a/worktree-x')]: 'editor:vscode',
          [externalAppTargetKey('/repo-a/worktree-y')]: 'terminal:ghostty',
          'workspace-root': 'finder',
        },
      },
    },
  ])
})

test('overwrites an existing workspace external app recent on the same worktree key', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')

  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    targetKey: externalAppTargetKey('/repo-a/worktree-x'),
    itemId: 'editor:vscode',
  })
  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    targetKey: externalAppTargetKey('/repo-a/worktree-x'),
    itemId: 'editor:vscode',
  })

  expect(await mod.getServerWorkspaceSettings()).toEqual([
    {
      workspaceId: REPO_A,
      workspaceExternalAppRecent: {
        byTarget: {
          [externalAppTargetKey('/repo-a/worktree-x')]: 'editor:vscode',
        },
      },
    },
  ])
})

test('skips the file rewrite when the workspace external app recent is already current', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  const fs = await import('node:fs/promises')
  const dataFile = `${tmp}/user-settings.json`

  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    targetKey: externalAppTargetKey('/repo-a/worktree-x'),
    itemId: 'editor:vscode',
  })
  const mtimeBefore = (await fs.stat(dataFile)).mtimeMs

  // Sleep so the mtime can change if the file is rewritten.
  await new Promise((resolve) => setTimeout(resolve, 5))

  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    targetKey: externalAppTargetKey('/repo-a/worktree-x'),
    itemId: 'editor:vscode',
  })

  const mtimeAfter = (await fs.stat(dataFile)).mtimeMs
  expect(mtimeAfter).toBe(mtimeBefore)
})

test('rejects invalid workspace external app target and item without touching disk', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')

  await expect(mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    targetKey: 'git-worktree\0relative/path',
    itemId: 'editor:vscode',
  })).rejects.toThrow('invalid workspace external-app target')
  await expect(mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    targetKey: externalAppTargetKey('/repo-a'),
    itemId: '',
  })).rejects.toThrow('invalid workspace external-app item')
  await expect(mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    targetKey: externalAppTargetKey('/repo-a'),
    itemId: 'editor:vscode\0with-nul',
  })).rejects.toThrow('invalid workspace external-app item')

  expect(await mod.getServerWorkspaceSettings()).toEqual([])
})

function branchTargetKey(_workspaceId: string, branchName: string): string {
  return restorableWorkspacePaneTargetKey({ kind: 'git-branch', branch: branchName })
}

function worktreeTargetKey(worktreePath: string): string {
  const root = requiredFileWorkspaceLocator(worktreePath)
  return restorableWorkspacePaneTargetKey({ kind: 'git-worktree', root })
}

function externalAppTargetKey(worktreePath: string): string {
  return worktreeTargetKey(worktreePath)
}

function requiredFileWorkspaceLocator(worktreePath: string) {
  const root = formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: worktreePath }, 'posix')
  if (!root) throw new Error('invalid workspace locator fixture')
  return root
}

test('leaves malformed workspace external app recent entries in place and fails every read', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const initial = await import('#/server/modules/settings-source.ts')
  await initial.getUserSettings()
  initial.resetServerSettingsSourceForTests()
  vi.resetModules()
  const settingsFile = `${tmp}/user-settings.json`
  const persisted = JSON.parse(await readFile(settingsFile, 'utf-8'))
  await writeFile(
    settingsFile,
    JSON.stringify({
      ...persisted,
      workspaceSettings: [
        {
          workspaceId: REPO_A,
          workspaceExternalAppRecent: {
            byTarget: {
              [externalAppTargetKey('/repo-a/worktree-x')]: 'editor:vscode',
              [externalAppTargetKey('/repo-a/worktree-y')]: 'editor:webstorm',
              'relative/path': 'editor:vscode',
              '/repo-a/nul\0key': 'editor:vscode',
              'workspace-root': 'finder',
            },
          },
        },
      ],
    }),
    'utf-8',
  )

  const mod = await import('#/server/modules/settings-source.ts')

  await expect(mod.getServerWorkspaceSettings()).rejects.toThrow('invalid current settings shape')
  await expect(mod.getServerWorkspaceSettings()).rejects.toThrow('invalid current settings shape')
  expect(existsSync(settingsFile)).toBe(true)
  expect(readdirSync(tmp)).toEqual(['user-settings.json'])
})

test('setServerWorkspaceExternalAppRecent rejects unknown item ids without overwriting valid entries', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  // Seed a known-good entry so we can confirm the unknown-id write
  // is dropped (not persisted) without losing the existing one.
  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    targetKey: externalAppTargetKey('/repo-a/worktree-x'),
    itemId: 'editor:vscode',
  })

  await expect(mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    targetKey: externalAppTargetKey('/repo-a/worktree-y'),
    itemId: 'editor:webstorm',
  })).rejects.toThrow('invalid workspace external-app item')

  const persisted = await mod.getServerWorkspaceSettings()
  expect(persisted).toEqual([
    {
      workspaceId: REPO_A,
      workspaceExternalAppRecent: {
        byTarget: {
          [externalAppTargetKey('/repo-a/worktree-x')]: 'editor:vscode',
        },
      },
    },
  ])
})

test('prunes removed-worktree settings without dropping repo-level trust', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  const configHash = `sha256:${'a'.repeat(64)}`

  await mod.trustServerWorkspaceWorktreeBootstrapConfig({
    workspaceId: REPO_A,
    configHash,
  })
  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    targetKey: externalAppTargetKey('/repo-a/worktree-x'),
    itemId: 'editor:vscode',
  })
  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    targetKey: externalAppTargetKey('/repo-a/worktree-y'),
    itemId: 'terminal:ghostty',
  })

  await expect(
    mod.pruneServerWorkspaceSettingsForRemovedWorktree({
      workspaceId: REPO_A,
      worktreePath: '/repo-a/worktree-x',
    }),
  ).resolves.toBe(true)

  expect(await mod.getServerWorkspaceSettings()).toEqual([
    {
      workspaceId: REPO_A,
      worktreeBootstrapTrust: {
        configHash,
        trustedAt: expect.any(String),
      },
      workspaceExternalAppRecent: {
        byTarget: {
          [externalAppTargetKey('/repo-a/worktree-y')]: 'terminal:ghostty',
        },
      },
    },
  ])
})

test('prunes empty workspace settings entries after removed-worktree cleanup', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')

  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    targetKey: externalAppTargetKey('/repo-a/worktree-x'),
    itemId: 'editor:vscode',
  })

  await expect(
    mod.pruneServerWorkspaceSettingsForRemovedWorktree({
      workspaceId: REPO_A,
      worktreePath: '/repo-a/worktree-x',
    }),
  ).resolves.toBe(true)

  expect(await mod.getServerWorkspaceSettings()).toEqual([])
})
