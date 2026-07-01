// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { flushMicrotasks, renderInJsdom } from '#/test-utils/render.tsx'
import { useAuthenticatedAppBootstrap } from '#/web/hooks/useAuthenticatedAppBootstrap.ts'
import { usePublicAppBootstrap } from '#/web/hooks/usePublicAppBootstrap.ts'
import { getSettingsSnapshot } from '#/web/settings-client.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  filetreeInteractionScopeKey,
  resetFiletreeInteractionStore,
  useFiletreeInteractionStore,
} from '#/web/stores/repos/filetree-interaction-state.ts'
import { useSessionRestoreStore } from '#/web/stores/session-restore.ts'
import { resetReposStore } from '#/web/test-utils/bridge.ts'
import { useThemeStore } from '#/web/stores/theme.ts'
import { restoreServerWorkspacePaneTabsFromSession } from '#/web/workspace-pane/workspace-pane-session-tabs-restore.ts'

vi.mock('#/web/settings-client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/web/settings-client.ts')>()
  return {
    ...actual,
    getSettingsSnapshot: vi.fn(),
  }
})

vi.mock('#/web/workspace-pane/workspace-pane-session-tabs-restore.ts', () => ({
  restoreServerWorkspacePaneTabsFromSession: vi.fn(async () => true),
}))

const mockedGetSettingsSnapshot = vi.mocked(getSettingsSnapshot)
const mockedRestoreServerWorkspacePaneTabsFromSession = vi.mocked(restoreServerWorkspacePaneTabsFromSession)

beforeEach(() => {
  resetReposStore()
  resetFiletreeInteractionStore()
  vi.restoreAllMocks()
  mockedGetSettingsSnapshot.mockReset()
  mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
  mockedRestoreServerWorkspacePaneTabsFromSession.mockReset()
  mockedRestoreServerWorkspacePaneTabsFromSession.mockResolvedValue(true)
  useSessionRestoreStore.setState({ bootSessionSnapshot: null })
})

describe('app bootstrap hooks', () => {
  test('public bootstrap hydrates only unauthenticated-safe stores', async () => {
    const hydrateTheme = vi.spyOn(useThemeStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const hydrateSessionRestore = vi.spyOn(useSessionRestoreStore.getState(), 'hydrate').mockResolvedValue({
      openRepoEntries: [{ kind: 'local', id: '/tmp/repo' }],
      activeRepoId: '/tmp/repo',
      zenMode: true,
      workspacePaneSize: 50,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByBranchByRepo: {},
      workspacePaneTabsByBranchByRepo: {},
      filetreeViewStateByWorktreeByRepo: {},
    })
    const hydrateI18n = vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const hydrateHostInfo = vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)

    renderInJsdom(<PublicHarness />)
    await flushMicrotasks(3)

    expect(hydrateI18n).not.toHaveBeenCalled()
    expect(hydrateHostInfo).toHaveBeenCalled()
    expect(hydrateTheme).not.toHaveBeenCalled()
    expect(hydrateSessionRestore).not.toHaveBeenCalled()
    expect(mockedGetSettingsSnapshot).not.toHaveBeenCalled()
  })

  test('canonicalizes boot session pane state before applying it to the repos store', async () => {
    const session = {
      openRepoEntries: [{ kind: 'local' as const, id: '/tmp/repo' }],
      activeRepoId: '/tmp/repo',
      zenMode: false,
      workspacePaneSize: 45,
      selectedTerminalSessionIdByTerminalWorktree: { '/tmp/repo\0/tmp/worktree': 'session-2' },
      preferredWorkspacePaneTabByBranchByRepo: {},
      workspacePaneTabsByBranchByRepo: {
        '/tmp/repo': {
          main: [],
        },
      },
      filetreeViewStateByWorktreeByRepo: {
        '/tmp/repo': {
          '/tmp/worktree': {
            selectedKeys: ['src/index.ts'],
            expandedKeys: ['src'],
            topVisibleRowIndex: 140,
          },
        },
      },
    }
    const settings = defaultSettingsSnapshot({ session })
    mockedGetSettingsSnapshot.mockResolvedValue(settings)
    const hydrateTheme = vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const hydrateRepoSession = vi.spyOn(useReposStore.getState(), 'hydrateRepoSession').mockResolvedValue(undefined)

    renderInJsdom(<Harness />)
    await flushMicrotasks(3)

    const state = useReposStore.getState()
    expect(state.zenMode).toBe(false)
    expect(state.workspacePaneSize).toBe(45)
    expect(state.selectedTerminalSessionIdByTerminalWorktree).toEqual({
      '/tmp/repo\0/tmp/worktree': 'session-2',
    })
    expect(useFiletreeInteractionStore.getState().interactionByScope).toMatchObject({
      [filetreeInteractionScopeKey('/tmp/repo', '/tmp/worktree')]: {
        selectedKeys: ['src/index.ts'],
        expandedKeys: ['src'],
        topVisibleRowIndex: 140,
      },
    })
    expect(hydrateRepoSession).toHaveBeenCalledWith([{ kind: 'local', id: '/tmp/repo' }], '/tmp/repo', {
      workspacePaneRestoreState: {
        workspacePaneTabsByBranchByRepo: {
          '/tmp/repo': {
            main: [],
          },
        },
        preferredWorkspacePaneTabByBranchByRepo: {},
      },
    })
    expect(hydrateTheme).toHaveBeenCalledWith(settings)
    expect(mockedGetSettingsSnapshot).toHaveBeenCalledTimes(1)
    expect(state.sessionPersistenceReady).toBe(true)
  })

  test('restores the boot session when non-critical authenticated hydrates fail', async () => {
    const session = {
      openRepoEntries: [{ kind: 'local' as const, id: '/tmp/repo' }],
      activeRepoId: '/tmp/repo',
      zenMode: true,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByBranchByRepo: {},
      workspacePaneTabsByBranchByRepo: {},
      filetreeViewStateByWorktreeByRepo: {},
    }
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot({ session }))
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockRejectedValue(new Error('theme unavailable'))
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockRejectedValue(new Error('i18n unavailable'))
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockRejectedValue(new Error('host unavailable'))
    const hydrateRepoSession = vi.spyOn(useReposStore.getState(), 'hydrateRepoSession').mockResolvedValue(undefined)

    renderInJsdom(<Harness />)
    await flushMicrotasks(3)

    expect(hydrateRepoSession).toHaveBeenCalledWith([{ kind: 'local', id: '/tmp/repo' }], '/tmp/repo', {
      workspacePaneRestoreState: {
        workspacePaneTabsByBranchByRepo: {},
        preferredWorkspacePaneTabByBranchByRepo: {},
      },
    })
    expect(useReposStore.getState().workspacePaneSize).toBe(55)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(true)
    expect(mockedGetSettingsSnapshot).toHaveBeenCalledTimes(1)
  })

  test('keeps persistence gated when server workspace tabs restore fails', async () => {
    const session = {
      openRepoEntries: [{ kind: 'local' as const, id: '/tmp/repo' }],
      activeRepoId: '/tmp/repo',
      zenMode: true,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByBranchByRepo: {},
      workspacePaneTabsByBranchByRepo: {
        '/tmp/repo': {
          main: [],
        },
      },
      filetreeViewStateByWorktreeByRepo: {},
    }
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot({ session }))
    mockedRestoreServerWorkspacePaneTabsFromSession.mockResolvedValue(false)
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useReposStore.getState(), 'hydrateRepoSession').mockResolvedValue(undefined)

    renderInJsdom(<Harness />)
    await flushMicrotasks(3)

    expect(useReposStore.getState().sessionPersistenceReady).toBe(false)
    expect(mockedRestoreServerWorkspacePaneTabsFromSession).toHaveBeenCalledWith({
      '/tmp/repo': {
        main: [],
      },
    })
  })

  test('opens the persistence gate even when boot session restore fails', async () => {
    mockedGetSettingsSnapshot.mockRejectedValue(new Error('settings unavailable'))

    renderInJsdom(<Harness />)
    await flushMicrotasks(3)

    expect(useReposStore.getState().sessionReady).toBe(true)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(true)
  })
})

function Harness() {
  useAuthenticatedAppBootstrap()
  return null
}

function PublicHarness() {
  usePublicAppBootstrap()
  return null
}
