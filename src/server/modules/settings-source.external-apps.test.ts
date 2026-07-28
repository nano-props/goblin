import { afterEach, describe, expect, test, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'
import { restorableWorkspacePaneTargetKey } from '#/shared/workspace-pane-tabs-target.ts'
import { formatWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

let testDataDir: string | null = null
let previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
const REPO_A = workspaceIdForTest('goblin+file:///repo-a')

function prepareSettingsDataDir(): string {
  testDataDir = mkdtempSync(path.join(os.tmpdir(), 'goblin-server-settings-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = testDataDir
  return testDataDir
}

afterEach(async () => {
  const mod = await import('#/server/modules/settings-source.ts')
  mod.resetServerSettingsSourceForTests()
  if (testDataDir) rmSync(testDataDir, { recursive: true, force: true })
  testDataDir = null
  if (previousDataDir === undefined) delete process.env.GOBLIN_SERVER_DATA_DIR
  else process.env.GOBLIN_SERVER_DATA_DIR = previousDataDir
  vi.resetModules()
  vi.doUnmock('write-file-atomic')
})

describe('settings source external app recents', () => {
  test('records the most recent workspace external app per canonical filesystem target', async () => {
    prepareSettingsDataDir()
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

  test('overwrites an existing recent on the same worktree key', async () => {
    prepareSettingsDataDir()
    const mod = await import('#/server/modules/settings-source.ts')

    await mod.setServerWorkspaceExternalAppRecent({
      workspaceId: REPO_A,
      targetKey: externalAppTargetKey('/repo-a/worktree-x'),
      itemId: 'editor:vscode',
    })
    await mod.setServerWorkspaceExternalAppRecent({
      workspaceId: REPO_A,
      targetKey: externalAppTargetKey('/repo-a/worktree-x'),
      itemId: 'terminal:ghostty',
    })

    await expect(mod.getServerWorkspaceSettings()).resolves.toEqual([
      {
        workspaceId: REPO_A,
        workspaceExternalAppRecent: {
          byTarget: { [externalAppTargetKey('/repo-a/worktree-x')]: 'terminal:ghostty' },
        },
      },
    ])
  })

  test('skips persistence when the recent is already current', async () => {
    prepareSettingsDataDir()
    const writeFileAtomic = vi.fn(async (file: string, payload: string) => {
      await writeFile(file, payload, 'utf-8')
    })
    vi.doMock('write-file-atomic', () => ({ default: writeFileAtomic }))
    const mod = await import('#/server/modules/settings-source.ts')
    const input = {
      workspaceId: REPO_A,
      targetKey: externalAppTargetKey('/repo-a/worktree-x'),
      itemId: 'editor:vscode',
    }

    await mod.setServerWorkspaceExternalAppRecent(input)
    const writesAfterChange = writeFileAtomic.mock.calls.length
    await mod.setServerWorkspaceExternalAppRecent(input)

    expect(writesAfterChange).toBeGreaterThan(0)
    expect(writeFileAtomic).toHaveBeenCalledTimes(writesAfterChange)
  })

  test('rejects invalid target and item inputs without touching disk', async () => {
    const dataDir = prepareSettingsDataDir()
    const mod = await import('#/server/modules/settings-source.ts')

    await expect(
      mod.setServerWorkspaceExternalAppRecent({
        workspaceId: REPO_A,
        targetKey: 'git-worktree\0relative/path',
        itemId: 'editor:vscode',
      }),
    ).rejects.toThrow('invalid workspace external-app target')
    await expect(
      mod.setServerWorkspaceExternalAppRecent({
        workspaceId: REPO_A,
        targetKey: externalAppTargetKey('/repo-a'),
        itemId: '',
      }),
    ).rejects.toThrow('invalid workspace external-app item')
    await expect(
      mod.setServerWorkspaceExternalAppRecent({
        workspaceId: REPO_A,
        targetKey: externalAppTargetKey('/repo-a'),
        itemId: 'editor:vscode\0with-nul',
      }),
    ).rejects.toThrow('invalid workspace external-app item')

    expect(readdirSync(dataDir)).toEqual([])
    expect(await mod.getServerWorkspaceSettings()).toEqual([])
  })

  test('replaces settings containing malformed workspace entries with defaults', async () => {
    const dataDir = prepareSettingsDataDir()
    const initial = await import('#/server/modules/settings-source.ts')
    await initial.getUserSettings()
    initial.resetServerSettingsSourceForTests()
    vi.resetModules()
    const settingsFile = `${dataDir}/user-settings.json`
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

    await expect(mod.getServerWorkspaceSettings()).resolves.toEqual([])
    expect(JSON.parse(await readFile(settingsFile, 'utf-8'))).toMatchObject({
      workspaceSettings: [],
      workspace: defaultServerWorkspaceState(),
    })
    expect(existsSync(settingsFile)).toBe(true)
    expect(readdirSync(dataDir)).toEqual(['user-settings.json'])
  })

  test('rejects unknown item ids without overwriting valid entries', async () => {
    prepareSettingsDataDir()
    const mod = await import('#/server/modules/settings-source.ts')
    await mod.setServerWorkspaceExternalAppRecent({
      workspaceId: REPO_A,
      targetKey: externalAppTargetKey('/repo-a/worktree-x'),
      itemId: 'editor:vscode',
    })

    await expect(
      mod.setServerWorkspaceExternalAppRecent({
        workspaceId: REPO_A,
        targetKey: externalAppTargetKey('/repo-a/worktree-y'),
        itemId: 'editor:webstorm',
      }),
    ).rejects.toThrow('invalid workspace external-app item')

    await expect(mod.getServerWorkspaceSettings()).resolves.toEqual([
      {
        workspaceId: REPO_A,
        workspaceExternalAppRecent: {
          byTarget: { [externalAppTargetKey('/repo-a/worktree-x')]: 'editor:vscode' },
        },
      },
    ])
  })

  test('prunes removed-worktree settings without dropping repo-level trust', async () => {
    prepareSettingsDataDir()
    const mod = await import('#/server/modules/settings-source.ts')
    const configHash = `sha256:${'a'.repeat(64)}`

    await mod.trustServerWorkspaceWorktreeBootstrapConfig({ workspaceId: REPO_A, configHash })
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
        worktreeBootstrapTrust: { configHash, trustedAt: expect.any(String) },
        workspaceExternalAppRecent: {
          byTarget: { [externalAppTargetKey('/repo-a/worktree-y')]: 'terminal:ghostty' },
        },
      },
    ])
  })

  test('prunes empty workspace settings entries after removed-worktree cleanup', async () => {
    prepareSettingsDataDir()
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
})

function externalAppTargetKey(worktreePath: string): string {
  const root = formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: worktreePath }, 'posix')
  if (!root) throw new Error('invalid workspace locator fixture')
  return restorableWorkspacePaneTargetKey({ kind: 'git-worktree', root })
}
