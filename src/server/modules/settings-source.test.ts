import { afterEach, expect, test, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'
import { WORKSPACE_PANE_STATIC_TAB_IDS, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'

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
  expect(await mod.getServerRecentRepos()).toEqual([])
  expect(await mod.getServerRepoSettings()).toEqual([])
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
    globalShortcut: 'CommandOrControl+Alt+G',
    lanEnabled: false,
  })
  await mod.recordServerWorkspacePaneLayout('/repo-b', {
    entries: [{ repoRoot: '/repo-b', branchName: 'main', worktreePath: null, tabs: [] }],
  })
  await mod.addServerRecentRepo({ kind: 'local', id: '/repo-b' })
  await mod.trustServerRepoWorktreeBootstrapConfig({
    repoId: '/repo-b',
    configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  })
  unsubscribe()

  expect(sec).toBe(42)
  expect(listener).toHaveBeenCalledWith(42)
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
    globalShortcut: 'Alt+G',
    lanEnabled: false,
  })
  expect(await reloaded.getServerWorkspaceState()).toMatchObject({
    workspacePaneTabsByTargetByRepo: {
      '/repo-b': {
        [branchTargetKey('/repo-b', 'main')]: [],
      },
    },
  })
  expect(await reloaded.getServerRecentRepos()).toEqual([{ kind: 'local', id: '/repo-b' }])
  expect(await reloaded.getServerRepoSettings()).toEqual([
    {
      repoId: '/repo-b',
      worktreeBootstrapTrust: {
        configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        trustedAt: expect.any(String),
      },
    },
  ])
})

test('quarantines corrupt settings JSON before rebuilding defaults', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  await writeFile(path.join(tmp, 'user-settings.json'), '{bad json', 'utf-8')

  const mod = await import('#/server/modules/settings-source.ts')

  await expect(mod.getServerFetchIntervalSec()).resolves.toBe(120)
  expect(JSON.parse(await readFile(path.join(tmp, 'user-settings.json'), 'utf-8'))).toMatchObject({
    lang: 'auto',
    fetchIntervalSec: 120,
  })
  expect(readdirSync(tmp).some((name) => name.startsWith('user-settings.json.corrupt-'))).toBe(true)
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
    mod.addServerRecentRepo({ kind: 'local', id: '/repo-a' }),
    mod.addServerRecentRepo({ kind: 'local', id: '/repo-b' }),
    mod.addServerRecentRepo({ kind: 'local', id: '/repo-c' }),
  ])

  expect(await mod.getServerRecentRepos()).toEqual([
    { kind: 'local', id: '/repo-c' },
    { kind: 'local', id: '/repo-b' },
    { kind: 'local', id: '/repo-a' },
  ])
  expect(existsSync(path.join(tmp, 'user-settings.json'))).toBe(true)
})

test('stores the shared open repo order without applying the recent-repo limit', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  const entries = Array.from({ length: 12 }, (_, index) => ({ kind: 'local' as const, id: `/repo-${index}` }))

  for (const entry of entries) await mod.addServerWorkspaceRepo(entry)
  await mod.addServerWorkspaceRepo(entries[3]!)

  expect((await mod.getServerWorkspaceState()).openRepoEntries).toEqual(entries)
})

test('repairs open repos only when the source membership is unchanged', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  const repoA = { kind: 'local' as const, id: '/repo-a' }
  const repoB = { kind: 'local' as const, id: '/repo-b' }
  const repoC = { kind: 'local' as const, id: '/repo-c' }
  await mod.addServerWorkspaceRepo(repoA)
  await mod.addServerWorkspaceRepo(repoB)

  await expect(mod.compareAndReplaceServerWorkspaceRepos([repoA, repoB], [repoA])).resolves.toMatchObject({
    matched: true,
    workspace: { openRepoEntries: [repoA] },
  })
  await mod.addServerWorkspaceRepo(repoC)
  await expect(mod.compareAndReplaceServerWorkspaceRepos([repoA], [])).resolves.toMatchObject({
    matched: false,
    latestWorkspace: { openRepoEntries: [repoA, repoC] },
  })
})

test('confirms one canonical workspace repo entry without writing settings', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  const entry = { kind: 'local' as const, id: '/repo-a' }
  await mod.addServerWorkspaceRepo(entry)

  await expect(mod.confirmServerWorkspaceRepoEntry(entry)).resolves.toMatchObject({ matched: true })
  await mod.removeServerWorkspaceRepo(entry.id)
  await expect(mod.confirmServerWorkspaceRepoEntry(entry)).resolves.toMatchObject({
    matched: false,
    latestWorkspace: { openRepoEntries: [] },
  })
})

test('persists durable tabs independently of runtime membership', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  await mod.recordServerWorkspacePaneLayout('/repo-a', {
    entries: [
      {
        repoRoot: '/repo-a',
        branchName: 'main',
        worktreePath: null,
        tabs: [workspacePaneStaticTabEntry('history')],
      },
    ],
  })

  await expect(mod.getServerWorkspaceState()).resolves.toMatchObject({
    workspacePaneTabsByTargetByRepo: {
      '/repo-a': { [branchTargetKey('/repo-a', 'main')]: [workspacePaneStaticTabEntry('history')] },
    },
  })
  mod.resetServerSettingsSourceForTests()
  vi.resetModules()
  const reloaded = await import('#/server/modules/settings-source.ts')
  await expect(reloaded.getServerWorkspaceState()).resolves.toMatchObject({
    workspacePaneTabsByTargetByRepo: {
      '/repo-a': { [branchTargetKey('/repo-a', 'main')]: [workspacePaneStaticTabEntry('history')] },
    },
  })
})

test('clears unchanged repo tabs without affecting another repo', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  const repoATabs = [workspacePaneStaticTabEntry('history')]
  const repoBTabs = [workspacePaneStaticTabEntry('status')]
  await mod.addServerWorkspaceRepo({ kind: 'local', id: '/repo-a' })
  await mod.recordServerWorkspacePaneLayout('/repo-a', {
    entries: [{ repoRoot: '/repo-a', branchName: 'main', worktreePath: null, tabs: repoATabs }],
  })
  await mod.recordServerWorkspacePaneLayout('/repo-b', {
    entries: [{ repoRoot: '/repo-b', branchName: 'main', worktreePath: null, tabs: repoBTabs }],
  })

  await expect(
    mod.clearServerWorkspaceTabsIfUnchanged({
      repoRoot: '/repo-a',
      expectedRepoEntry: { kind: 'local', id: '/repo-a' },
      expectedTabsByTarget: { [branchTargetKey('/repo-a', 'main')]: repoATabs },
    }),
  ).resolves.toMatchObject({
    cleared: true,
    workspace: {
      workspacePaneTabsByTargetByRepo: {
        '/repo-b': { [branchTargetKey('/repo-b', 'main')]: repoBTabs },
      },
    },
  })
})

test('does not clear repo tabs after that repo changed', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  const currentTabs = [workspacePaneStaticTabEntry('history')]
  await mod.addServerWorkspaceRepo({ kind: 'local', id: '/repo-a' })
  await mod.recordServerWorkspacePaneLayout('/repo-a', {
    entries: [{ repoRoot: '/repo-a', branchName: 'main', worktreePath: null, tabs: currentTabs }],
  })

  await expect(
    mod.clearServerWorkspaceTabsIfUnchanged({
      repoRoot: '/repo-a',
      expectedRepoEntry: { kind: 'local', id: '/repo-a' },
      expectedTabsByTarget: {
        [branchTargetKey('/repo-a', 'main')]: [workspacePaneStaticTabEntry('status')],
      },
    }),
  ).resolves.toMatchObject({
    cleared: false,
    latestWorkspace: {
      workspacePaneTabsByTargetByRepo: {
        '/repo-a': { [branchTargetKey('/repo-a', 'main')]: currentTabs },
      },
    },
  })
})

test('does not clear repo tabs after workspace membership is removed', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  const entry = { kind: 'local' as const, id: '/repo-a' }
  const tabs = [workspacePaneStaticTabEntry('history')]
  await mod.addServerWorkspaceRepo(entry)
  await mod.recordServerWorkspacePaneLayout('/repo-a', {
    entries: [{ repoRoot: '/repo-a', branchName: 'main', worktreePath: null, tabs }],
  })
  await mod.removeServerWorkspaceRepo('/repo-a')

  await expect(
    mod.clearServerWorkspaceTabsIfUnchanged({
      repoRoot: '/repo-a',
      expectedRepoEntry: entry,
      expectedTabsByTarget: { [branchTargetKey('/repo-a', 'main')]: tabs },
    }),
  ).resolves.toMatchObject({ cleared: false, latestWorkspace: { openRepoEntries: [] } })
  expect((await mod.getServerWorkspaceState()).workspacePaneTabsByTargetByRepo['/repo-a']).toBeDefined()
})

test('confirms repo tabs only while membership and layout are unchanged', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  const entry = { kind: 'local' as const, id: '/repo-a' }
  const tabs = [workspacePaneStaticTabEntry('history')]
  const expectedTabsByTarget = { [branchTargetKey('/repo-a', 'main')]: tabs }
  await mod.addServerWorkspaceRepo(entry)
  await mod.recordServerWorkspacePaneLayout('/repo-a', {
    entries: [{ repoRoot: '/repo-a', branchName: 'main', worktreePath: null, tabs }],
  })

  await expect(
    mod.confirmServerWorkspaceTabsUnchanged({
      repoRoot: '/repo-a',
      expectedRepoEntry: entry,
      expectedTabsByTarget,
    }),
  ).resolves.toMatchObject({ matched: true })

  await mod.removeServerWorkspaceRepo('/repo-a')
  await expect(
    mod.confirmServerWorkspaceTabsUnchanged({
      repoRoot: '/repo-a',
      expectedRepoEntry: entry,
      expectedTabsByTarget,
    }),
  ).resolves.toMatchObject({ matched: false, latestWorkspace: { openRepoEntries: [] } })
})

test('updates repo-level worktree bootstrap trust by repo id', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')

  await mod.trustServerRepoWorktreeBootstrapConfig({
    repoId: '/repo-a',
    configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  })
  await mod.trustServerRepoWorktreeBootstrapConfig({
    repoId: '/repo-a',
    configHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  })
  await mod.trustServerRepoWorktreeBootstrapConfig({
    repoId: '/repo-b',
    configHash: 'not-a-hash',
  })

  expect(await mod.getServerRepoSettings()).toEqual([
    {
      repoId: '/repo-a',
      worktreeBootstrapTrust: {
        configHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        trustedAt: expect.any(String),
      },
    },
  ])
})

test('clears repo-level worktree bootstrap trust without dropping other repo settings', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

  await mod.trustServerRepoWorktreeBootstrapConfig({
    repoId: '/repo-a',
    configHash,
  })
  await mod.setServerRepoWorkspaceExternalAppRecent({
    repoId: '/repo-a',
    worktreePath: '/repo-a-worktree',
    itemId: 'editor:vscode',
  })

  await expect(
    mod.untrustServerRepoWorktreeBootstrapConfig({
      repoId: '/repo-a',
      configHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    }),
  ).resolves.toBe(false)
  await expect(mod.untrustServerRepoWorktreeBootstrapConfig({ repoId: '/repo-a', configHash })).resolves.toBe(true)

  expect(await mod.getServerRepoSettings()).toEqual([
    {
      repoId: '/repo-a',
      workspaceExternalAppRecent: { byWorktree: { '/repo-a-worktree': 'editor:vscode' } },
    },
  ])
})

test('clears empty repo settings entry when removing only worktree bootstrap trust', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

  await mod.trustServerRepoWorktreeBootstrapConfig({
    repoId: '/repo-a',
    configHash,
  })

  await expect(mod.untrustServerRepoWorktreeBootstrapConfig({ repoId: '/repo-a', configHash })).resolves.toBe(true)
  expect(await mod.getServerRepoSettings()).toEqual([])
})

test('normalizes workspace pane tab list in server sessions', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  const mainTargetKey = branchTargetKey('/repo-b', 'main')
  const worktreeTargetKeyValue = worktreeTargetKey('/repo-b', 'feature/worktree', '/tmp/repo-b-worktree')
  const emptyTargetKey = branchTargetKey('/repo-b', 'empty')
  const invalidTargetKey = branchTargetKey('/repo-b', 'invalid')
  await mod.recordServerWorkspacePaneLayout('/repo-b', {
    entries: [
      {
        repoRoot: '/repo-b',
        branchName: 'main',
        worktreePath: null,
        tabs: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneStaticTabEntry('history'),
          workspacePaneStaticTabEntry('status'),
          workspacePaneStaticTabEntry('changes'),
        ],
      },
      {
        repoRoot: '/repo-b',
        branchName: 'feature/worktree',
        worktreePath: '/tmp/repo-b-worktree',
        tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('changes')],
      },
      { repoRoot: '/repo-b', branchName: 'empty', worktreePath: null, tabs: [] },
      {
        repoRoot: '/repo-b',
        branchName: 'invalid',
        worktreePath: null,
        tabs: [{ type: 'changes', tabId: WORKSPACE_PANE_STATIC_TAB_IDS.status }],
      },
    ] as never,
  })

  expect(await mod.getServerWorkspaceState()).toMatchObject({
    workspacePaneTabsByTargetByRepo: {
      '/repo-b': {
        [mainTargetKey]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
        [worktreeTargetKeyValue]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('changes')],
        [emptyTargetKey]: [],
        [invalidTargetKey]: [],
      },
    },
  })
})

test('records the most recent workspace external app per (repo, worktree)', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')

  await mod.setServerRepoWorkspaceExternalAppRecent({
    repoId: '/repo-a',
    worktreePath: '/repo-a/worktree-x',
    itemId: 'editor:vscode',
  })
  await mod.setServerRepoWorkspaceExternalAppRecent({
    repoId: '/repo-a',
    worktreePath: '/repo-a/worktree-y',
    itemId: 'terminal:ghostty',
  })
  await mod.setServerRepoWorkspaceExternalAppRecent({
    repoId: '/repo-a',
    worktreePath: null,
    itemId: 'finder',
  })

  expect(await mod.getServerRepoSettings()).toEqual([
    {
      repoId: '/repo-a',
      workspaceExternalAppRecent: {
        byWorktree: {
          '/repo-a/worktree-x': 'editor:vscode',
          '/repo-a/worktree-y': 'terminal:ghostty',
          '': 'finder',
        },
      },
    },
  ])

  mod.resetServerSettingsSourceForTests()
  vi.resetModules()
  const reloaded = await import('#/server/modules/settings-source.ts')
  expect(await reloaded.getServerRepoSettings()).toEqual([
    {
      repoId: '/repo-a',
      workspaceExternalAppRecent: {
        byWorktree: {
          '/repo-a/worktree-x': 'editor:vscode',
          '/repo-a/worktree-y': 'terminal:ghostty',
          '': 'finder',
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

  await mod.setServerRepoWorkspaceExternalAppRecent({
    repoId: '/repo-a',
    worktreePath: '/repo-a/worktree-x',
    itemId: 'editor:vscode',
  })
  await mod.setServerRepoWorkspaceExternalAppRecent({
    repoId: '/repo-a',
    worktreePath: '/repo-a/worktree-x',
    itemId: 'editor:vscode',
  })

  expect(await mod.getServerRepoSettings()).toEqual([
    {
      repoId: '/repo-a',
      workspaceExternalAppRecent: {
        byWorktree: {
          '/repo-a/worktree-x': 'editor:vscode',
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

  await mod.setServerRepoWorkspaceExternalAppRecent({
    repoId: '/repo-a',
    worktreePath: '/repo-a/worktree-x',
    itemId: 'editor:vscode',
  })
  const mtimeBefore = (await fs.stat(dataFile)).mtimeMs

  // Sleep so the mtime can change if the file is rewritten.
  await new Promise((resolve) => setTimeout(resolve, 5))

  await mod.setServerRepoWorkspaceExternalAppRecent({
    repoId: '/repo-a',
    worktreePath: '/repo-a/worktree-x',
    itemId: 'editor:vscode',
  })

  const mtimeAfter = (await fs.stat(dataFile)).mtimeMs
  expect(mtimeAfter).toBe(mtimeBefore)
})

test('rejects invalid workspace external app recent input without touching disk', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')

  await mod.setServerRepoWorkspaceExternalAppRecent({
    repoId: '',
    worktreePath: '/repo-a',
    itemId: 'editor:vscode',
  })
  await mod.setServerRepoWorkspaceExternalAppRecent({
    repoId: '/repo-a',
    worktreePath: 'relative/path',
    itemId: 'editor:vscode',
  })
  await mod.setServerRepoWorkspaceExternalAppRecent({
    repoId: '/repo-a',
    worktreePath: '/repo-a',
    itemId: '',
  })
  await mod.setServerRepoWorkspaceExternalAppRecent({
    repoId: '/repo-a',
    worktreePath: '/repo-a',
    itemId: 'editor:vscode\0with-nul',
  })

  expect(await mod.getServerRepoSettings()).toEqual([])
})

function branchTargetKey(repoRoot: string, branchName: string): string {
  return workspacePaneTabsTargetIdentityKey({ repoRoot, branchName, worktreePath: null })
}

function worktreeTargetKey(repoRoot: string, branchName: string, worktreePath: string): string {
  return workspacePaneTabsTargetIdentityKey({ repoRoot, branchName, worktreePath })
}

test('normalizer drops malformed workspace external app recent entries on load', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const fs = await import('node:fs/promises')
  await fs.writeFile(
    `${tmp}/user-settings.json`,
    JSON.stringify({
      repoSettings: [
        {
          repoId: '/repo-a',
          workspaceExternalAppRecent: {
            byWorktree: {
              '/repo-a/worktree-x': 'editor:vscode',
              // Unknown item id (not in WORKSPACE_EXTERNAL_APP_IDS) —
              // the normalizer must drop the entry.
              '/repo-a/worktree-y': 'editor:webstorm',
              // Path-invalid entries (relative path, NUL byte) must
              // also be dropped.
              'relative/path': 'editor:vscode',
              '/repo-a/nul\0key': 'editor:vscode',
              '': 'finder',
            },
          },
        },
      ],
    }),
    'utf-8',
  )

  const mod = await import('#/server/modules/settings-source.ts')

  expect(await mod.getServerRepoSettings()).toEqual([
    {
      repoId: '/repo-a',
      workspaceExternalAppRecent: {
        byWorktree: {
          '/repo-a/worktree-x': 'editor:vscode',
          '': 'finder',
        },
      },
    },
  ])
})

test('setServerRepoWorkspaceExternalAppRecent silently drops unknown item ids without overwriting valid entries', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  // Seed a known-good entry so we can confirm the unknown-id write
  // is dropped (not persisted) without losing the existing one.
  await mod.setServerRepoWorkspaceExternalAppRecent({
    repoId: '/repo-a',
    worktreePath: '/repo-a/worktree-x',
    itemId: 'editor:vscode',
  })

  await mod.setServerRepoWorkspaceExternalAppRecent({
    repoId: '/repo-a',
    worktreePath: '/repo-a/worktree-y',
    itemId: 'editor:webstorm',
  })

  const persisted = await mod.getServerRepoSettings()
  expect(persisted).toEqual([
    {
      repoId: '/repo-a',
      workspaceExternalAppRecent: {
        byWorktree: {
          '/repo-a/worktree-x': 'editor:vscode',
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

  await mod.trustServerRepoWorktreeBootstrapConfig({
    repoId: '/repo-a',
    configHash,
  })
  await mod.setServerRepoWorkspaceExternalAppRecent({
    repoId: '/repo-a',
    worktreePath: '/repo-a/worktree-x',
    itemId: 'editor:vscode',
  })
  await mod.setServerRepoWorkspaceExternalAppRecent({
    repoId: '/repo-a',
    worktreePath: '/repo-a/worktree-y',
    itemId: 'terminal:ghostty',
  })

  await expect(
    mod.pruneServerRepoSettingsForRemovedWorktree({
      repoId: '/repo-a',
      worktreePath: '/repo-a/worktree-x',
    }),
  ).resolves.toBe(true)

  expect(await mod.getServerRepoSettings()).toEqual([
    {
      repoId: '/repo-a',
      worktreeBootstrapTrust: {
        configHash,
        trustedAt: expect.any(String),
      },
      workspaceExternalAppRecent: {
        byWorktree: {
          '/repo-a/worktree-y': 'terminal:ghostty',
        },
      },
    },
  ])
})

test('prunes empty repo settings entries after removed-worktree cleanup', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')

  await mod.setServerRepoWorkspaceExternalAppRecent({
    repoId: '/repo-a',
    worktreePath: '/repo-a/worktree-x',
    itemId: 'editor:vscode',
  })

  await expect(
    mod.pruneServerRepoSettingsForRemovedWorktree({
      repoId: '/repo-a',
      worktreePath: '/repo-a/worktree-x',
    }),
  ).resolves.toBe(true)

  expect(await mod.getServerRepoSettings()).toEqual([])
})
