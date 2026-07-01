import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkspaceSessionState } from '#/shared/api-types.ts'
import { resolveI18nSnapshot } from '#/shared/i18n/snapshot.ts'
import { WORKSPACE_PANE_STATIC_TAB_IDS, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'

const mocks = vi.hoisted(() => ({
  publishSettingsInvalidation: vi.fn(),
  addServerRecentRepo: vi.fn(),
  clearServerRecentRepos: vi.fn(),
  setServerFetchIntervalSec: vi.fn(),
  setServerSessionState: vi.fn(),
  updateUserSettings: vi.fn(),
  settingsInvalidationScopesForPrefsPatch: vi.fn(),
}))

vi.mock('#/server/modules/invalidation-broker.ts', () => ({
  publishSettingsInvalidation: mocks.publishSettingsInvalidation,
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  addServerRecentRepo: mocks.addServerRecentRepo,
  clearServerRecentRepos: mocks.clearServerRecentRepos,
  setServerFetchIntervalSec: mocks.setServerFetchIntervalSec,
  setServerSessionState: mocks.setServerSessionState,
  updateUserSettings: mocks.updateUserSettings,
}))

vi.mock('#/shared/server-invalidation.ts', async () => {
  const actual = await vi.importActual<typeof import('#/shared/server-invalidation.ts')>(
    '#/shared/server-invalidation.ts',
  )
  return {
    ...actual,
    settingsInvalidationScopesForPrefsPatch: mocks.settingsInvalidationScopesForPrefsPatch,
  }
})

describe('settings command handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns authoritative i18n snapshot together with updated prefs for language writes', async () => {
    const updatedSettings = {
      lang: 'ja',
      theme: 'auto',
      colorTheme: 'macos',
      fetchIntervalSec: 120,
      terminalNotificationsEnabled: false,
      shortcutsDisabled: false,
      globalShortcutDisabled: false,
      globalShortcut: 'CommandOrControl+Shift+G',
      lanEnabled: false,
    } as const
    const i18nSnapshot = resolveI18nSnapshot('ja', 'ja-JP,ja;q=0.9,en;q=0.8')
    mocks.updateUserSettings.mockResolvedValue(updatedSettings)
    mocks.settingsInvalidationScopesForPrefsPatch.mockReturnValue(['i18n'])
    const { handleUpdateUserSettings } = await import('#/server/modules/settings-write-paths.ts')

    await expect(
      handleUpdateUserSettings(
        { prefs: { lang: 'ja' } },
        { acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.8', signal: new AbortController().signal },
      ),
    ).resolves.toEqual({
      ok: true,
      prefs: updatedSettings,
      i18n: i18nSnapshot,
    })
    expect(mocks.publishSettingsInvalidation).toHaveBeenCalledWith(['i18n'])
  })

  test('persists session state without publishing settings invalidation', async () => {
    const session: WorkspaceSessionState = {
      openRepoEntries: [],
      activeRepoId: null,
      zenMode: true,
      workspacePaneSize: 50,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByRepo: {},
      workspacePaneTabsByTargetByRepo: {},
      filetreeViewStateByWorktreeByRepo: {},
    }
    mocks.setServerSessionState.mockResolvedValue(session)
    mocks.setServerSessionState.mockResolvedValue(session as WorkspaceSessionState)
    const { handleSetSession } = await import('#/server/modules/settings-write-paths.ts')

    await expect(handleSetSession({ session })).resolves.toEqual({
      ok: true,
      session,
    })
    expect(mocks.setServerSessionState).toHaveBeenCalledWith(session)
    expect(mocks.publishSettingsInvalidation).not.toHaveBeenCalled()
  })

  test('adds recent repos and publishes settings snapshot invalidation', async () => {
    const repo = { kind: 'local', id: '/tmp/repo-a' } as const
    mocks.addServerRecentRepo.mockResolvedValue([repo])
    const { handleAddRecentRepo } = await import('#/server/modules/settings-write-paths.ts')

    await expect(handleAddRecentRepo({ repo })).resolves.toEqual({
      ok: true,
      recentRepos: [repo],
      addedRepo: repo,
    })
    expect(mocks.publishSettingsInvalidation).toHaveBeenCalledWith(['settings-snapshot'])
  })

  test('schema rejects malformed fetch interval at the perimeter', async () => {
    const { SETTINGS_PROCEDURE_SCHEMAS } = await import('#/shared/procedure-schemas.ts')
    const { parseHttpInput } = await import('#/server/common/http-validate.ts')
    expect(() => parseHttpInput(SETTINGS_PROCEDURE_SCHEMAS.fetchInterval, { sec: '5m' })).toThrow()
  })

  test('schema accepts well-formed session state via the perimeter', async () => {
    const { SETTINGS_PATCH_SCHEMAS } = await import('#/shared/procedure-schemas.ts')
    const { parseHttpInput } = await import('#/server/common/http-validate.ts')
    const parsed = parseHttpInput(SETTINGS_PATCH_SCHEMAS.session, {
      session: {
        openRepoEntries: [],
        activeRepoId: null,
        zenMode: true,
        workspacePaneSize: 42.5,
        selectedTerminalSessionIdByTerminalWorktree: {},
        preferredWorkspacePaneTabByTargetByRepo: {},
        workspacePaneTabsByTargetByRepo: {},
        filetreeViewStateByWorktreeByRepo: {},
      },
    })
    expect(parsed.session.zenMode).toBe(true)
    expect(parsed.session.workspacePaneSize).toBe(42.5)
  })

  test('schema accepts changes as a session-restorable preferred tab', async () => {
    const { SETTINGS_PATCH_SCHEMAS } = await import('#/shared/procedure-schemas.ts')
    const { parseHttpInput } = await import('#/server/common/http-validate.ts')
    const targetKey = branchTargetKey('/tmp/repo', 'main')

    expect(() =>
      parseHttpInput(SETTINGS_PATCH_SCHEMAS.session, {
        session: {
          openRepoEntries: [{ kind: 'local', id: '/tmp/repo' }],
          activeRepoId: '/tmp/repo',
          zenMode: true,
          workspacePaneSize: 42.5,
          selectedTerminalSessionIdByTerminalWorktree: {},
          preferredWorkspacePaneTabByTargetByRepo: {
            '/tmp/repo': {
              [targetKey]: 'changes',
            },
          },
          workspacePaneTabsByTargetByRepo: {
            '/tmp/repo': {
              [targetKey]: [workspacePaneStaticTabEntry('changes')],
            },
          },
          filetreeViewStateByWorktreeByRepo: {},
        },
      }),
    ).not.toThrow()
  })

  test('schema rejects malformed workspace pane tab list entries at the perimeter', async () => {
    const { SETTINGS_PATCH_SCHEMAS } = await import('#/shared/procedure-schemas.ts')
    const { parseHttpInput } = await import('#/server/common/http-validate.ts')
    const targetKey = branchTargetKey('/tmp/repo', 'main')

    const session = {
      openRepoEntries: [{ kind: 'local', id: '/tmp/repo' }],
      activeRepoId: '/tmp/repo',
      zenMode: true,
      workspacePaneSize: 42.5,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByRepo: {},
      workspacePaneTabsByTargetByRepo: {
        '/tmp/repo': {
          [targetKey]: [],
        },
      },
      filetreeViewStateByWorktreeByRepo: {},
    }

    expect(() =>
      parseHttpInput(SETTINGS_PATCH_SCHEMAS.session, {
        session: {
          ...session,
          workspacePaneTabsByTargetByRepo: {
            '/tmp/repo': {
              [targetKey]: [{ type: 'status', tabId: WORKSPACE_PANE_STATIC_TAB_IDS.history }],
            },
          },
        },
      }),
    ).toThrow()
    expect(() =>
      parseHttpInput(SETTINGS_PATCH_SCHEMAS.session, {
        session: {
          ...session,
          workspacePaneTabsByTargetByRepo: {
            '/tmp/repo': {
              [targetKey]: [{ type: 'terminal', terminalSessionId: '' }],
            },
          },
        },
      }),
    ).toThrow()
  })
})

function branchTargetKey(repoRoot: string, branchName: string): string {
  return workspacePaneTabsTargetIdentityKey({ repoRoot, branchName, worktreePath: null })
}
