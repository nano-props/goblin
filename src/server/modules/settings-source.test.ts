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

let tmp: string | null = null
let previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
const REPO_A = workspaceIdForTest('goblin+file:///repo-a')
const REPO_B = workspaceIdForTest('goblin+file:///repo-b')
const REPO_C = workspaceIdForTest('goblin+file:///repo-c')

async function writeWorkspacePaneLayout(
  source: { serverWorkspacePaneLayoutRepository: WorkspacePaneLayoutRepository },
  repoRoot: string,
  replacement: WorkspacePaneDurableLayout,
): Promise<void> {
  const current = await source.serverWorkspacePaneLayoutRepository.load(repoRoot)
  const outcome = await source.serverWorkspacePaneLayoutRepository.compareAndSwap({
    repoRoot,
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
    globalShortcut: 'CommandOrControl+Alt+G',
    lanEnabled: false,
  })
  await writeWorkspacePaneLayout(mod, REPO_B, {
    entries: [{ target: { kind: 'git-branch', branch: 'main' }, tabs: [] }],
  })
  await mod.addServerRecentWorkspace({ kind: 'local', id: REPO_B })
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
    globalShortcut: 'Alt+G',
    lanEnabled: false,
  })
  expect(await reloaded.getServerWorkspaceState()).toMatchObject({
    workspacePaneTabsByTargetByWorkspace: {
      [REPO_B]: {
        [branchTargetKey(REPO_B, 'main')]: [],
      },
    },
  })
  expect(await reloaded.getServerRecentWorkspaces()).toEqual([{ kind: 'local', id: REPO_B }])
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
    mod.addServerRecentWorkspace({ kind: 'local', id: REPO_A }),
    mod.addServerRecentWorkspace({ kind: 'local', id: REPO_B }),
    mod.addServerRecentWorkspace({ kind: 'local', id: REPO_C }),
  ])

  expect(await mod.getServerRecentWorkspaces()).toEqual([
    { kind: 'local', id: REPO_C },
    { kind: 'local', id: REPO_B },
    { kind: 'local', id: REPO_A },
  ])
  expect(existsSync(path.join(tmp, 'user-settings.json'))).toBe(true)
})

test('stores the shared open repo order without applying the recent-workspace limit', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  const entries = Array.from({ length: 12 }, (_, index) => ({
    kind: 'local' as const,
    id: workspaceIdForTest(`goblin+file:///repo-${index}`),
  }))

  for (const entry of entries) await mod.addServerWorkspaceEntry(entry)
  await mod.addServerWorkspaceEntry(entries[3]!)

  expect((await mod.getServerWorkspaceState()).openWorkspaceEntries).toEqual(entries)
})

test('repairs open repos only when the source membership is unchanged', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  const repoA = { kind: 'local' as const, id: REPO_A }
  const repoB = { kind: 'local' as const, id: REPO_B }
  const repoC = { kind: 'local' as const, id: REPO_C }
  await mod.addServerWorkspaceEntry(repoA)
  await mod.addServerWorkspaceEntry(repoB)

  await expect(mod.compareAndReplaceServerWorkspaceEntries([repoA, repoB], [repoA])).resolves.toMatchObject({
    matched: true,
    workspace: { openWorkspaceEntries: [repoA] },
  })
  await mod.addServerWorkspaceEntry(repoC)
  await expect(mod.compareAndReplaceServerWorkspaceEntries([repoA], [])).resolves.toMatchObject({
    matched: false,
    latestWorkspace: { openWorkspaceEntries: [repoA, repoC] },
  })
})

test('confirms one canonical workspace repo entry without writing settings', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const mod = await import('#/server/modules/settings-source.ts')
  const entry = { kind: 'local' as const, id: REPO_A }
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
  const repoEntry = { kind: 'local' as const, id: REPO_A }
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
    repoRoot: REPO_A,
    expected: empty,
    replacement: history,
  })
  await expect(
    mod.serverWorkspacePaneLayoutRestoreTransaction.validateMembershipAndLoad({
      repoRoot: REPO_A,
      expectedRepoEntry: repoEntry,
    }),
  ).resolves.toMatchObject({ kind: 'accepted', snapshot: { layout: history } })
  await expect(
    mod.serverWorkspacePaneLayoutRepository.compareAndSwap({
      repoRoot: REPO_A,
      expected: history,
      replacement: history,
    }),
  ).resolves.toMatchObject({ kind: 'accepted', changed: false })
  await expect(
    mod.serverWorkspacePaneLayoutRepository.compareAndSwap({
      repoRoot: REPO_A,
      expected: empty,
      replacement: empty,
    }),
  ).resolves.toMatchObject({ kind: 'conflict', snapshot: { layout: history } })

  await mod.removeServerWorkspaceEntry(REPO_A)
  await expect(
    mod.serverWorkspacePaneLayoutRestoreTransaction.validateMembershipAndLoad({
      repoRoot: REPO_A,
      expectedRepoEntry: repoEntry,
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
      repoRoot: REPO_A,
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
      repoRoot: REPO_A,
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
  const repoEntry = { kind: 'local' as const, id: REPO_A }
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
      repoRoot: REPO_A,
      expectedRepoEntry: repoEntry,
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
    worktreePath: '/repo-a-worktree',
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
      workspaceExternalAppRecent: { byWorktree: { '/repo-a-worktree': 'editor:vscode' } },
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
  const worktreeTargetKeyValue = worktreeTargetKey(REPO_B, 'feature/worktree', '/tmp/repo-b-worktree')
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

test('records the most recent workspace external app per (repo, worktree)', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')

  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    worktreePath: '/repo-a/worktree-x',
    itemId: 'editor:vscode',
  })
  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    worktreePath: '/repo-a/worktree-y',
    itemId: 'terminal:ghostty',
  })
  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    worktreePath: null,
    itemId: 'finder',
  })

  expect(await mod.getServerWorkspaceSettings()).toEqual([
    {
      workspaceId: REPO_A,
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
  expect(await reloaded.getServerWorkspaceSettings()).toEqual([
    {
      workspaceId: REPO_A,
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

  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    worktreePath: '/repo-a/worktree-x',
    itemId: 'editor:vscode',
  })
  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    worktreePath: '/repo-a/worktree-x',
    itemId: 'editor:vscode',
  })

  expect(await mod.getServerWorkspaceSettings()).toEqual([
    {
      workspaceId: REPO_A,
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

  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    worktreePath: '/repo-a/worktree-x',
    itemId: 'editor:vscode',
  })
  const mtimeBefore = (await fs.stat(dataFile)).mtimeMs

  // Sleep so the mtime can change if the file is rewritten.
  await new Promise((resolve) => setTimeout(resolve, 5))

  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    worktreePath: '/repo-a/worktree-x',
    itemId: 'editor:vscode',
  })

  const mtimeAfter = (await fs.stat(dataFile)).mtimeMs
  expect(mtimeAfter).toBe(mtimeBefore)
})

test('rejects invalid workspace external app recent path and item without touching disk', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')

  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    worktreePath: 'relative/path',
    itemId: 'editor:vscode',
  })
  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    worktreePath: '/repo-a',
    itemId: '',
  })
  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    worktreePath: '/repo-a',
    itemId: 'editor:vscode\0with-nul',
  })

  expect(await mod.getServerWorkspaceSettings()).toEqual([])
})

function branchTargetKey(_repoRoot: string, branchName: string): string {
  return restorableWorkspacePaneTargetKey({ kind: 'git-branch', branch: branchName })
}

function worktreeTargetKey(_repoRoot: string, _branchName: string, worktreePath: string): string {
  const root = requiredFileWorkspaceLocator(worktreePath)
  return restorableWorkspacePaneTargetKey({ kind: 'git-worktree', root })
}

function requiredFileWorkspaceLocator(worktreePath: string) {
  const root = formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: worktreePath }, 'posix')
  if (!root) throw new Error('invalid workspace locator fixture')
  return root
}

test('normalizer drops malformed workspace external app recent entries on load', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const fs = await import('node:fs/promises')
  await fs.writeFile(
    `${tmp}/user-settings.json`,
    JSON.stringify({
      workspaceSettings: [
        {
          workspaceId: REPO_A,
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

  expect(await mod.getServerWorkspaceSettings()).toEqual([
    {
      workspaceId: REPO_A,
      workspaceExternalAppRecent: {
        byWorktree: {
          '/repo-a/worktree-x': 'editor:vscode',
          '': 'finder',
        },
      },
    },
  ])
})

test('migrates legacy repo settings at the persistence boundary and writes only workspace settings', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const settingsFile = path.join(tmp, 'user-settings.json')
  const configHash = `sha256:${'a'.repeat(64)}`
  await writeFile(
    settingsFile,
    JSON.stringify({
      repoSettings: [{ repoId: REPO_A, worktreeBootstrapTrust: { configHash, trustedAt: '2026-01-01T00:00:00.000Z' } }],
    }),
    'utf-8',
  )

  const mod = await import('#/server/modules/settings-source.ts')
  expect(await mod.getServerWorkspaceSettings()).toEqual([
    {
      workspaceId: REPO_A,
      worktreeBootstrapTrust: { configHash, trustedAt: '2026-01-01T00:00:00.000Z' },
    },
  ])

  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    worktreePath: '/workspace/worktree',
    itemId: 'editor:vscode',
  })

  const persisted = JSON.parse(await readFile(settingsFile, 'utf-8')) as Record<string, unknown>
  expect(persisted).not.toHaveProperty('repoSettings')
  expect(persisted).toMatchObject({
    workspaceSettings: [
      {
        workspaceId: REPO_A,
        worktreeBootstrapTrust: { configHash },
        workspaceExternalAppRecent: { byWorktree: { '/workspace/worktree': 'editor:vscode' } },
      },
    ],
  })
})

test('setServerWorkspaceExternalAppRecent silently drops unknown item ids without overwriting valid entries', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  // Seed a known-good entry so we can confirm the unknown-id write
  // is dropped (not persisted) without losing the existing one.
  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    worktreePath: '/repo-a/worktree-x',
    itemId: 'editor:vscode',
  })

  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    worktreePath: '/repo-a/worktree-y',
    itemId: 'editor:webstorm',
  })

  const persisted = await mod.getServerWorkspaceSettings()
  expect(persisted).toEqual([
    {
      workspaceId: REPO_A,
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

  await mod.trustServerWorkspaceWorktreeBootstrapConfig({
    workspaceId: REPO_A,
    configHash,
  })
  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    worktreePath: '/repo-a/worktree-x',
    itemId: 'editor:vscode',
  })
  await mod.setServerWorkspaceExternalAppRecent({
    workspaceId: REPO_A,
    worktreePath: '/repo-a/worktree-y',
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
        byWorktree: {
          '/repo-a/worktree-y': 'terminal:ghostty',
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
    worktreePath: '/repo-a/worktree-x',
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
