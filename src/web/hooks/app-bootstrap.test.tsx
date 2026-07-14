// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { flushMicrotasks, renderInJsdom } from '#/test-utils/render.tsx'
import { useAuthenticatedAppBootstrap } from '#/web/hooks/useAuthenticatedAppBootstrap.ts'
import { usePublicAppBootstrap } from '#/web/hooks/usePublicAppBootstrap.ts'
import { getExternalAppsSnapshot, getSettingsSnapshot } from '#/web/settings-client.ts'
import { restorePersistedWorkspaceSession } from '#/web/settings-actions.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  filetreeInteractionScopeKey,
  resetFiletreeInteractionStore,
  useFiletreeInteractionStore,
} from '#/web/stores/repos/filetree-interaction-state.ts'
import { resetReposStore } from '#/web/test-utils/bridge.ts'
import { useThemeStore } from '#/web/stores/theme.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { externalAppsQueryKey, settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import type { WorkspaceRuntimeRestoreSnapshot } from '#/shared/api-types.ts'

vi.mock('#/web/settings-client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/web/settings-client.ts')>()
  return {
    ...actual,
    getExternalAppsSnapshot: vi.fn(),
    getSettingsSnapshot: vi.fn(),
  }
})

vi.mock('#/web/settings-actions.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/web/settings-actions.ts')>()
  return {
    ...actual,
    restorePersistedWorkspaceSession: vi.fn(),
  }
})

const mockedGetExternalAppsSnapshot = vi.mocked(getExternalAppsSnapshot)
const mockedGetSettingsSnapshot = vi.mocked(getSettingsSnapshot)
const mockedRestorePersistedWorkspaceSession = vi.mocked(restorePersistedWorkspaceSession)

beforeEach(() => {
  vi.useRealTimers()
  resetReposStore()
  resetFiletreeInteractionStore()
  primaryWindowQueryClient.clear()
  vi.restoreAllMocks()
  mockedGetExternalAppsSnapshot.mockReset()
  mockedGetExternalAppsSnapshot.mockResolvedValue(defaultExternalAppsSnapshot())
  mockedGetSettingsSnapshot.mockReset()
  const settings = defaultSettingsSnapshot()
  mockedGetSettingsSnapshot.mockResolvedValue(settings)
  mockedRestorePersistedWorkspaceSession.mockReset()
  mockServerRestore(settings.session)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('app bootstrap hooks', () => {
  test('public bootstrap hydrates only unauthenticated-safe stores', async () => {
    const hydrateTheme = vi.spyOn(useThemeStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const hydrateI18n = vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const hydrateHostInfo = vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)

    renderInJsdom(<PublicHarness />)
    await flushMicrotasks(3)

    expect(hydrateI18n).not.toHaveBeenCalled()
    expect(hydrateHostInfo).toHaveBeenCalled()
    expect(hydrateTheme).not.toHaveBeenCalled()
    expect(mockedGetSettingsSnapshot).not.toHaveBeenCalled()
  })

  test('canonicalizes boot session pane state before applying it to the repos store', async () => {
    const targetKey = branchTargetKey('/tmp/repo', 'main')
    const session = {
      openRepoEntries: [{ kind: 'local' as const, id: '/tmp/repo' }],
      restoredRepoId: '/tmp/repo',
      zenMode: false,
      workspacePaneSize: 45,
      selectedTerminalSessionIdByTerminalWorktree: { '/tmp/repo\0/tmp/worktree': 'term-222222222222222222222' },
      preferredWorkspacePaneTabByTargetByRepo: {},
      workspacePaneTabsByTargetByRepo: {
        '/tmp/repo': {
          [targetKey]: [],
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
    mockServerRestore(session)
    const hydrateTheme = vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const hydrateRestoredRuntime = vi
      .spyOn(useReposStore.getState(), 'hydrateRestoredWorkspaceRuntime')
      .mockResolvedValue(undefined)

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(hydrateRestoredRuntime).toHaveBeenCalled()
    })

    const state = useReposStore.getState()
    expect(state.zenMode).toBe(false)
    expect(state.workspacePaneSize).toBe(45)
    expect(state.selectedTerminalSessionIdByTerminalWorktree).toEqual({
      '/tmp/repo\0/tmp/worktree': 'term-222222222222222222222',
    })
    expect(useFiletreeInteractionStore.getState().interactionByScope).toMatchObject({
      [filetreeInteractionScopeKey('/tmp/repo', '/tmp/worktree')]: {
        selectedKeys: ['src/index.ts'],
        expandedKeys: ['src'],
        topVisibleRowIndex: 140,
      },
    })
    expect(hydrateRestoredRuntime).toHaveBeenCalledWith(restoredRuntimeForSession(session), {
      signal: expect.any(AbortSignal),
      restoredSession: session,
    })
    expect(hydrateTheme).toHaveBeenCalledWith(settings)
    expect(mockedGetSettingsSnapshot).toHaveBeenCalledTimes(1)
    expect(mockedGetExternalAppsSnapshot).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
    expect(primaryWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toEqual(settings)
    expect(primaryWindowQueryClient.getQueryData(externalAppsQueryKey())).toEqual(defaultExternalAppsSnapshot())
    expect(state.sessionPersistenceReady).toBe(true)
  })

  test('passes the routed repo root to server workspace restore', async () => {
    renderInJsdom(<Harness activeRepoRoot="/tmp/routed-repo" />)

    await vi.waitFor(() => {
      expect(mockedRestorePersistedWorkspaceSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          activeRepoRoot: '/tmp/routed-repo',
          signal: expect.any(AbortSignal),
        }),
      )
    })
  })

  test('restores the boot session when non-critical authenticated hydrates fail', async () => {
    const session = {
      openRepoEntries: [{ kind: 'local' as const, id: '/tmp/repo' }],
      restoredRepoId: '/tmp/repo',
      zenMode: true,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByRepo: {},
      workspacePaneTabsByTargetByRepo: {},
      filetreeViewStateByWorktreeByRepo: {},
    }
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot({ session }))
    mockServerRestore(session)
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockRejectedValue(new Error('theme unavailable'))
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockRejectedValue(new Error('i18n unavailable'))
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockRejectedValue(new Error('host unavailable'))
    const hydrateRestoredRuntime = vi
      .spyOn(useReposStore.getState(), 'hydrateRestoredWorkspaceRuntime')
      .mockResolvedValue(undefined)

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(hydrateRestoredRuntime).toHaveBeenCalled()
    })

    expect(hydrateRestoredRuntime).toHaveBeenCalledWith(restoredRuntimeForSession(session), {
      signal: expect.any(AbortSignal),
      restoredSession: session,
    })
    expect(useReposStore.getState().workspacePaneSize).toBe(55)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(true)
    expect(mockedGetSettingsSnapshot).toHaveBeenCalledTimes(1)
  })

  test('blocks persistence when server session restore fails', async () => {
    const session = {
      openRepoEntries: [{ kind: 'local' as const, id: '/tmp/repo' }],
      restoredRepoId: '/tmp/repo',
      zenMode: true,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByRepo: {},
      workspacePaneTabsByTargetByRepo: {},
      filetreeViewStateByWorktreeByRepo: {},
    }
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot({ session }))
    mockedRestorePersistedWorkspaceSession.mockRejectedValue(new Error('server session restore failed'))
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const hydrateRestoredRuntime = vi
      .spyOn(useReposStore.getState(), 'hydrateRestoredWorkspaceRuntime')
      .mockResolvedValue(undefined)

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    })

    expect(useReposStore.getState().sessionPersistenceReady).toBe(false)
    expect(useReposStore.getState().sessionRestoreError).toBe('server session restore failed')
    expect(hydrateRestoredRuntime).not.toHaveBeenCalled()
  })

  test('continues with a clean rebuilt session returned by server restore', async () => {
    const persistedSession = {
      openRepoEntries: [{ kind: 'local' as const, id: '/tmp/repo' }],
      restoredRepoId: '/tmp/repo',
      zenMode: true,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByRepo: {
        '/tmp/repo': {
          [branchTargetKey('/tmp/repo', 'main')]: 'files' as const,
        },
      },
      workspacePaneTabsByTargetByRepo: {},
      filetreeViewStateByWorktreeByRepo: {},
    }
    const rebuiltSession = {
      ...persistedSession,
      preferredWorkspacePaneTabByTargetByRepo: {},
      workspacePaneTabsByTargetByRepo: {},
    }
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot({ session: persistedSession }))
    mockedRestorePersistedWorkspaceSession.mockResolvedValue({
      status: 'rebuilt',
      session: rebuiltSession,
      runtime: restoredRuntimeForSession(rebuiltSession),
    })
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const hydrateRestoredRuntime = vi
      .spyOn(useReposStore.getState(), 'hydrateRestoredWorkspaceRuntime')
      .mockResolvedValue(undefined)

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(useReposStore.getState().sessionPersistenceReady).toBe(true)
    })

    expect(hydrateRestoredRuntime).toHaveBeenCalledWith(restoredRuntimeForSession(rebuiltSession), {
      signal: expect.any(AbortSignal),
      restoredSession: rebuiltSession,
    })
    expect(primaryWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({ session: rebuiltSession })
    expect(useReposStore.getState().sessionRestoreError).toBeNull()
  })

  test('blocks persistence when repo session hydration fails', async () => {
    const session = {
      openRepoEntries: [{ kind: 'local' as const, id: '/tmp/missing-repo' }],
      restoredRepoId: '/tmp/missing-repo',
      zenMode: true,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByRepo: {},
      workspacePaneTabsByTargetByRepo: {},
      filetreeViewStateByWorktreeByRepo: {},
    }
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot({ session }))
    mockServerRestore(session)
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useReposStore.getState(), 'hydrateRestoredWorkspaceRuntime').mockRejectedValue(
      new Error('session repo restore failed'),
    )

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    })

    expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(false)
    expect(useReposStore.getState().sessionRestoreError).toBe('session repo restore failed')
  })

  test('blocks persistence but releases workspace skeleton when boot session restore fails', async () => {
    mockedGetSettingsSnapshot.mockRejectedValue(new Error('settings unavailable'))

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    })

    expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(false)
    expect(useReposStore.getState().sessionRestoreError).toBe('settings unavailable')
  })

  test('times out authenticated workspace restore when settings hangs', async () => {
    vi.useFakeTimers()
    mockedGetSettingsSnapshot.mockImplementation(({ signal }: { signal?: AbortSignal } = {}) => {
      return new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    renderInJsdom(<Harness />)

    await vi.advanceTimersByTimeAsync(30_000)
    await flushMicrotasks(3)

    expect(mockedGetSettingsSnapshot).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
    expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(false)
    expect(useReposStore.getState().sessionRestoreError).toBe('authenticated workspace restore timed out after 30000ms')
  })

  test('reports timeout when server session restore does not return after abort', async () => {
    vi.useFakeTimers()
    const session = {
      openRepoEntries: [{ kind: 'local' as const, id: '/tmp/repo' }],
      restoredRepoId: '/tmp/repo',
      zenMode: true,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByRepo: {},
      workspacePaneTabsByTargetByRepo: {},
      filetreeViewStateByWorktreeByRepo: {},
    }
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot({ session }))
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useReposStore.getState(), 'hydrateRestoredWorkspaceRuntime').mockResolvedValue(undefined)
    mockedRestorePersistedWorkspaceSession.mockImplementation(() => new Promise(() => {}))

    renderInJsdom(<Harness />)
    await flushMicrotasks(3)
    await vi.advanceTimersByTimeAsync(30_000)
    await flushMicrotasks(3)

    expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(false)
    expect(useReposStore.getState().sessionRestoreError).toBe('authenticated workspace restore timed out after 30000ms')
  })

  test('reports timeout when repo session hydration does not return after abort', async () => {
    vi.useFakeTimers()
    const session = {
      openRepoEntries: [{ kind: 'local' as const, id: '/tmp/repo' }],
      restoredRepoId: '/tmp/repo',
      zenMode: true,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByRepo: {},
      workspacePaneTabsByTargetByRepo: {},
      filetreeViewStateByWorktreeByRepo: {},
    }
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot({ session }))
    mockServerRestore(session)
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useReposStore.getState(), 'hydrateRestoredWorkspaceRuntime').mockImplementation(
      () => new Promise(() => {}),
    )

    renderInJsdom(<Harness />)
    await flushMicrotasks(3)
    await vi.advanceTimersByTimeAsync(30_000)
    await flushMicrotasks(3)

    expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(false)
    expect(useReposStore.getState().sessionRestoreError).toBe('authenticated workspace restore timed out after 30000ms')
  })

  test('aborts authenticated workspace restore on unmount without committing restore failure', async () => {
    let signal: AbortSignal | undefined
    mockedGetSettingsSnapshot.mockImplementation((options: { signal?: AbortSignal } = {}) => {
      signal = options.signal
      return new Promise((_, reject) => {
        options.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('The operation was aborted.', 'AbortError')),
          { once: true },
        )
      })
    })

    const result = renderInJsdom(<Harness />)
    await flushMicrotasks(1)

    result.unmount()
    await flushMicrotasks(2)

    expect(signal?.aborted).toBe(true)
    expect(useReposStore.getState().workspaceMembershipReady).toBe(false)
    expect(useReposStore.getState().sessionRestoreError).toBeNull()
  })

  test('passes the restore abort signal to non-critical authenticated hydrates', async () => {
    let i18nSignal: AbortSignal | undefined
    let hostInfoSignal: AbortSignal | undefined
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockImplementation((options = {}) => {
      i18nSignal = options.signal
      return new Promise(() => {})
    })
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockImplementation((options = {}) => {
      hostInfoSignal = options.signal
      return new Promise(() => {})
    })
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useReposStore.getState(), 'hydrateRestoredWorkspaceRuntime').mockResolvedValue(undefined)

    const result = renderInJsdom(<Harness />)
    await flushMicrotasks(2)
    result.unmount()

    expect(i18nSignal?.aborted).toBe(true)
    expect(hostInfoSignal?.aborted).toBe(true)
  })

  test('allows a cancelled StrictMode-style first run to restart and finish', async () => {
    const first = Promise.withResolvers<never>()
    const secondSettings = defaultSettingsSnapshot()
    mockedGetSettingsSnapshot.mockImplementationOnce((options: { signal?: AbortSignal } = {}) => {
      options.signal?.addEventListener('abort', () => first.reject(options.signal?.reason), { once: true })
      return first.promise
    })
    mockedGetSettingsSnapshot.mockResolvedValueOnce(secondSettings)
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useReposStore.getState(), 'hydrateRestoredWorkspaceRuntime').mockResolvedValue(undefined)

    const result = renderInJsdom(<Harness />)
    await flushMicrotasks(1)
    result.unmount()
    await flushMicrotasks(2)

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(useReposStore.getState().sessionPersistenceReady).toBe(true)
    })

    expect(mockedGetSettingsSnapshot).toHaveBeenCalledTimes(2)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(true)
    expect(useReposStore.getState().sessionRestoreError).toBeNull()
  })
})

function Harness({ activeRepoRoot = null }: { activeRepoRoot?: string | null }) {
  useAuthenticatedAppBootstrap({ activeRepoRoot })
  return null
}

function PublicHarness() {
  usePublicAppBootstrap()
  return null
}

function mockServerRestore(session: ReturnType<typeof defaultSettingsSnapshot>['session']): void {
  mockedRestorePersistedWorkspaceSession.mockResolvedValue({
    status: 'restored',
    session,
    runtime: restoredRuntimeForSession(session),
  })
}

function restoredRuntimeForSession(
  session: ReturnType<typeof defaultSettingsSnapshot>['session'],
): WorkspaceRuntimeRestoreSnapshot {
  return {
    repos: session.openRepoEntries.map((entry) => ({
      entry,
      repoRoot: entry.id,
      repoRuntimeId: `repo-runtime-${entry.id}`,
      name: entry.id.split('/').pop() || entry.id,
      projection: {
        snapshot: {
          current: 'main',
          branches: [
            {
              name: 'main',
              isCurrent: true,
              ahead: 0,
              behind: 0,
              lastCommitHash: 'abc123',
              lastCommitShortHash: 'abc123',
              lastCommitMessage: 'Initial commit',
              lastCommitDate: '2024-01-01T00:00:00.000Z',
              lastCommitAuthor: 'Test User',
            },
          ],
        },
        status: [],
        pullRequests: null,
        operations: { operations: [], loadedAt: 0 },
        requested: { branch: null, pullRequestMode: 'full' as const },
        loadedAt: 1,
      },
    })),
    workspacePaneTabs: [],
    restoredRepoId: session.restoredRepoId,
  }
}

function defaultExternalAppsSnapshot() {
  return {
    terminal: {
      available: false,
      appAvailability: { ghostty: false, terminal: false, windowsTerminal: false },
      detectedAt: 0,
    },
    editor: {
      available: false,
      appAvailability: { vscode: false },
      detectedAt: 0,
    },
  }
}

function branchTargetKey(repoRoot: string, branchName: string): string {
  return workspacePaneTabsTargetIdentityKey({ repoRoot, branchName, worktreePath: null })
}
