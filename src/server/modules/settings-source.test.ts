import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultWorkspaceSessionState } from '#/shared/settings-defaults.ts'
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
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
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
  expect(await mod.getServerSessionState()).toMatchObject({
    openRepoEntries: [],
    restoredRepoId: null,
  })
  expect(await mod.getServerRecentRepos()).toEqual([])
  expect(await mod.getServerRepoSettings()).toEqual([])
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
  await mod.setServerSessionState({
    ...defaultWorkspaceSessionState(),
    openRepoEntries: [{ kind: 'local', id: '/repo-b' }],
    restoredRepoId: '/repo-b',
    selectedTerminalSessionIdByTerminalWorktree: { '/repo-b\0/worktree': 'session-2' },
    workspacePaneTabsByTargetByRepo: {
      '/repo-b': {
        [branchTargetKey('/repo-b', 'main')]: [],
      },
    },
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
  expect(await reloaded.getServerSessionState()).toMatchObject({
    openRepoEntries: [{ kind: 'local', id: '/repo-b' }],
    restoredRepoId: '/repo-b',
    selectedTerminalSessionIdByTerminalWorktree: { '/repo-b\0/worktree': 'session-2' },
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

test('updates repo-level worktree bootstrap trust by repo id', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
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
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
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
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
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

test('normalizes target-scoped workspace pane tab preferences in server sessions', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  const mainTargetKey = branchTargetKey('/repo-b', 'main')
  const changesTargetKey = branchTargetKey('/repo-b', 'changes')
  const terminalTargetKey = worktreeTargetKey('/repo-b', 'feature/worktree', '/tmp/repo-b-worktree')
  const invalidBranchTargetKey = '/repo-b\0branch\0bad\0branch'
  await mod.setServerSessionState({
    ...defaultWorkspaceSessionState(),
    openRepoEntries: [
      { kind: 'local', id: '/repo-b' },
      { kind: 'local', id: '/repo-array' },
    ],
    restoredRepoId: '/repo-b',
    preferredWorkspacePaneTabByTargetByRepo: {
      '/repo-b': {
        [mainTargetKey]: 'history',
        [changesTargetKey]: 'changes',
        [terminalTargetKey]: 'terminal',
        [invalidBranchTargetKey]: 'changes',
        [branchTargetKey('/repo-b', 'feature')]: 'not-a-pane-view',
      },
      '/repo-c': {
        [branchTargetKey('/repo-c', 'main')]: 'terminal',
      },
      '/repo-array': ['history'],
    } as never,
    workspacePaneTabsByTargetByRepo: {
      '/repo-b': {
        [mainTargetKey]: [workspacePaneStaticTabEntry('history')],
        [changesTargetKey]: [workspacePaneStaticTabEntry('changes')],
        [terminalTargetKey]: [
          workspacePaneStaticTabEntry('status'),
          { type: 'terminal', terminalSessionId: 'session-1' },
        ],
      },
    },
  })

  expect(await mod.getServerSessionState()).toMatchObject({
    preferredWorkspacePaneTabByTargetByRepo: {
      '/repo-b': {
        [mainTargetKey]: 'history',
        [terminalTargetKey]: 'terminal',
      },
    },
  })
})

test('normalizes workspace pane tab list in server sessions', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')
  const mainTargetKey = branchTargetKey('/repo-b', 'main')
  const worktreeTargetKeyValue = worktreeTargetKey('/repo-b', 'feature/worktree', '/tmp/repo-b-worktree')
  const emptyTargetKey = branchTargetKey('/repo-b', 'empty')
  const invalidTargetKey = branchTargetKey('/repo-b', 'invalid')
  await mod.setServerSessionState({
    ...defaultWorkspaceSessionState(),
    openRepoEntries: [
      { kind: 'local', id: '/repo-b' },
      { kind: 'local', id: '/repo-array' },
    ],
    restoredRepoId: '/repo-b',
    workspacePaneTabsByTargetByRepo: {
      '/repo-b': {
        [mainTargetKey]: [
          workspacePaneStaticTabEntry('status'),
          { type: 'terminal', terminalSessionId: 'session-1' },
          workspacePaneStaticTabEntry('history'),
          workspacePaneStaticTabEntry('status'),
          workspacePaneStaticTabEntry('changes'),
        ],
        [worktreeTargetKeyValue]: [
          workspacePaneStaticTabEntry('status'),
          { type: 'terminal', terminalSessionId: 'session-1' },
          workspacePaneStaticTabEntry('changes'),
        ],
        [emptyTargetKey]: [],
        '/repo-b\0branch\0bad\0branch': [workspacePaneStaticTabEntry('status')],
        [invalidTargetKey]: [{ type: 'changes', tabId: WORKSPACE_PANE_STATIC_TAB_IDS.status }],
      },
      '/repo-c': {
        [branchTargetKey('/repo-c', 'main')]: [workspacePaneStaticTabEntry('status')],
      },
      '/repo-array': [workspacePaneStaticTabEntry('status')],
    } as never,
  })

  expect(await mod.getServerSessionState()).toMatchObject({
    workspacePaneTabsByTargetByRepo: {
      '/repo-b': {
        [mainTargetKey]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
        [worktreeTargetKeyValue]: [
          workspacePaneStaticTabEntry('status'),
          { type: 'terminal', terminalSessionId: 'session-1' },
          workspacePaneStaticTabEntry('changes'),
        ],
        [emptyTargetKey]: [],
        [invalidTargetKey]: [],
      },
    },
  })
})

test('normalizes file tree view state in server sessions', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp

  const mod = await import('#/server/modules/settings-source.ts')

  await mod.setServerSessionState({
    ...defaultWorkspaceSessionState(),
    openRepoEntries: [
      { kind: 'local', id: '/repo-b' },
      { kind: 'local', id: '/repo-array' },
    ],
    restoredRepoId: '/repo-b',
    filetreeViewStateByWorktreeByRepo: {
      '/repo-b': {
        '/worktree': {
          selectedKeys: ['src/index.ts', 'src/index.ts', '', 'bad\0key'],
          expandedKeys: ['src', 'docs'],
          topVisibleRowIndex: -20,
        },
        empty: {
          selectedKeys: [],
          expandedKeys: [],
          topVisibleRowIndex: 0,
        },
        'bad\0worktree': {
          selectedKeys: ['README.md'],
          expandedKeys: [],
          topVisibleRowIndex: 0,
        },
      },
      '/repo-c': {
        '/worktree': {
          selectedKeys: ['README.md'],
          expandedKeys: [],
          topVisibleRowIndex: 0,
        },
      },
      '/repo-array': [] as never,
    },
  })

  expect(await mod.getServerSessionState()).toMatchObject({
    filetreeViewStateByWorktreeByRepo: {
      '/repo-b': {
        '/worktree': {
          selectedKeys: ['src/index.ts'],
          expandedKeys: ['src', 'docs'],
          topVisibleRowIndex: 0,
        },
      },
    },
  })
})

test('records the most recent workspace external app per (repo, worktree)', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
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
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
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
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
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
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
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
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
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
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
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
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
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
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-server-settings-'))
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
