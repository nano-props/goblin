// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'

vi.mock('#/web/settings-client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/web/settings-client.ts')>()
  return {
    ...actual,
    getSettingsSnapshot: vi.fn(),
  }
})

vi.mock('#/web/workspace-pane/workspace-pane-session-tabs-restore.ts', () => ({
  restoreServerWorkspacePaneTabsFromSession: vi.fn(async () => ({
    status: 'restored',
    unresolvedRepos: [],
    unresolvedTargets: [],
    failedCommits: [],
  })),
}))

const mockedGetSettingsSnapshot = vi.mocked(getSettingsSnapshot)
const mockedRestoreServerWorkspacePaneTabsFromSession = vi.mocked(restoreServerWorkspacePaneTabsFromSession)

beforeEach(() => {
  vi.useRealTimers()
  resetReposStore()
  resetFiletreeInteractionStore()
  vi.restoreAllMocks()
  mockedGetSettingsSnapshot.mockReset()
  mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
  mockedRestoreServerWorkspacePaneTabsFromSession.mockReset()
  mockedRestoreServerWorkspacePaneTabsFromSession.mockResolvedValue({
    status: 'restored',
    unresolvedRepos: [],
    unresolvedTargets: [],
    failedCommits: [],
  })
  useSessionRestoreStore.setState({ bootSessionSnapshot: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('app bootstrap hooks', () => {
  test('public bootstrap hydrates only unauthenticated-safe stores', async () => {
    const hydrateTheme = vi.spyOn(useThemeStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const hydrateSessionRestore = vi.spyOn(useSessionRestoreStore.getState(), 'hydrate').mockResolvedValue({
      openRepoEntries: [{ kind: 'local', id: '/tmp/repo' }],
      restoredRepoId: '/tmp/repo',
      zenMode: true,
      workspacePaneSize: 50,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByRepo: {},
      workspacePaneTabsByTargetByRepo: {},
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
    const targetKey = branchTargetKey('/tmp/repo', 'main')
    const session = {
      openRepoEntries: [{ kind: 'local' as const, id: '/tmp/repo' }],
      restoredRepoId: '/tmp/repo',
      zenMode: false,
      workspacePaneSize: 45,
      selectedTerminalSessionIdByTerminalWorktree: { '/tmp/repo\0/tmp/worktree': 'session-2' },
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
    const hydrateTheme = vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const hydrateRepoSession = vi.spyOn(useReposStore.getState(), 'hydrateRepoSession').mockResolvedValue(undefined)

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(hydrateRepoSession).toHaveBeenCalled()
    })

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
      signal: expect.any(AbortSignal),
      workspacePaneRestoreState: {
        workspacePaneTabsByTargetByRepo: {
          '/tmp/repo': {
            [targetKey]: [],
          },
        },
        preferredWorkspacePaneTabByTargetByRepo: {},
      },
    })
    expect(hydrateTheme).toHaveBeenCalledWith(settings)
    expect(mockedGetSettingsSnapshot).toHaveBeenCalledTimes(1)
    expect(state.sessionPersistenceReady).toBe(true)
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
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockRejectedValue(new Error('theme unavailable'))
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockRejectedValue(new Error('i18n unavailable'))
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockRejectedValue(new Error('host unavailable'))
    const hydrateRepoSession = vi.spyOn(useReposStore.getState(), 'hydrateRepoSession').mockResolvedValue(undefined)

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(hydrateRepoSession).toHaveBeenCalled()
    })

    expect(hydrateRepoSession).toHaveBeenCalledWith([{ kind: 'local', id: '/tmp/repo' }], '/tmp/repo', {
      signal: expect.any(AbortSignal),
      workspacePaneRestoreState: {
        workspacePaneTabsByTargetByRepo: {},
        preferredWorkspacePaneTabByTargetByRepo: {},
      },
    })
    expect(useReposStore.getState().workspacePaneSize).toBe(55)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(true)
    expect(mockedGetSettingsSnapshot).toHaveBeenCalledTimes(1)
  })

  test('reports unresolved workspace tabs restore entries as restore failure', async () => {
    const targetKey = branchTargetKey('/tmp/repo', 'main')
    const session = {
      openRepoEntries: [{ kind: 'local' as const, id: '/tmp/repo' }],
      restoredRepoId: '/tmp/repo',
      zenMode: true,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByRepo: {},
      workspacePaneTabsByTargetByRepo: {
        '/tmp/repo': {
          [targetKey]: [],
        },
      },
      filetreeViewStateByWorktreeByRepo: {},
    }
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot({ session }))
    mockedRestoreServerWorkspacePaneTabsFromSession.mockResolvedValue({
      status: 'failed',
      unresolvedRepos: ['/missing/repo'],
      unresolvedTargets: [{ repoRoot: '/tmp/repo', targetKey: '/tmp/repo\0branch\0missing' }],
      failedCommits: [],
    })
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useReposStore.getState(), 'hydrateRepoSession').mockResolvedValue(undefined)

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    })

    expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(false)
    expect(useReposStore.getState().sessionRestoreError).toBe('workspace pane tabs restore failed')
    expect(mockedRestoreServerWorkspacePaneTabsFromSession).toHaveBeenCalledWith(
      {
        '/tmp/repo': {
          [targetKey]: [],
        },
      },
      { signal: expect.any(AbortSignal) },
    )
  })

  test('blocks persistence when workspace preferred tab restore fails during repo hydration', async () => {
    const targetKey = branchTargetKey('/tmp/repo', 'main')
    const session = {
      openRepoEntries: [{ kind: 'local' as const, id: '/tmp/repo' }],
      restoredRepoId: '/tmp/repo',
      zenMode: true,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByRepo: {
        '/tmp/repo': {
          [targetKey]: 'files' as const,
        },
      },
      workspacePaneTabsByTargetByRepo: {},
      filetreeViewStateByWorktreeByRepo: {},
    }
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot({ session }))
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useReposStore.getState(), 'hydrateRepoSession').mockRejectedValue(
      new Error('workspace pane preferred tab restore failed'),
    )

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    })

    expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(false)
    expect(useReposStore.getState().sessionRestoreError).toBe('workspace pane preferred tab restore failed')
    expect(mockedRestoreServerWorkspacePaneTabsFromSession).not.toHaveBeenCalled()
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
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useReposStore.getState(), 'hydrateRepoSession').mockRejectedValue(new Error('session repo restore failed'))

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    })

    expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(false)
    expect(useReposStore.getState().sessionRestoreError).toBe('session repo restore failed')
    expect(mockedRestoreServerWorkspacePaneTabsFromSession).not.toHaveBeenCalled()
  })

  test('reports a failed server workspace tabs commit and keeps persistence blocked', async () => {
    const targetKey = branchTargetKey('/tmp/repo', 'main')
    const session = {
      openRepoEntries: [{ kind: 'local' as const, id: '/tmp/repo' }],
      restoredRepoId: '/tmp/repo',
      zenMode: true,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByRepo: {},
      workspacePaneTabsByTargetByRepo: {
        '/tmp/repo': {
          [targetKey]: [],
        },
      },
      filetreeViewStateByWorktreeByRepo: {},
    }
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot({ session }))
    mockedRestoreServerWorkspacePaneTabsFromSession.mockResolvedValue({
      status: 'failed',
      unresolvedRepos: [],
      unresolvedTargets: [],
      failedCommits: [
        {
          ok: false,
          operation: 'commit',
          repoRoot: '/tmp/repo',
          branchName: 'main',
          worktreePath: null,
          message: 'server unavailable',
          error: new Error('server unavailable'),
        },
      ],
    })
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useReposStore.getState(), 'hydrateRepoSession').mockResolvedValue(undefined)

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    })

    expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(false)
    expect(useReposStore.getState().sessionRestoreError).toBe('workspace pane tabs restore failed')
  })

  test('opens the persistence gate even when boot session restore fails', async () => {
    mockedGetSettingsSnapshot.mockRejectedValue(new Error('settings unavailable'))

    renderInJsdom(<Harness />)
    await flushMicrotasks(3)

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

  test('reports timeout when workspace tab restore is cancelled by the restore timeout', async () => {
    vi.useFakeTimers()
    const targetKey = branchTargetKey('/tmp/repo', 'main')
    const session = {
      openRepoEntries: [{ kind: 'local' as const, id: '/tmp/repo' }],
      restoredRepoId: '/tmp/repo',
      zenMode: true,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByRepo: {},
      workspacePaneTabsByTargetByRepo: {
        '/tmp/repo': {
          [targetKey]: [],
        },
      },
      filetreeViewStateByWorktreeByRepo: {},
    }
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot({ session }))
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useReposStore.getState(), 'hydrateRepoSession').mockResolvedValue(undefined)
    mockedRestoreServerWorkspacePaneTabsFromSession.mockImplementation(async (_tabs, { signal } = {}) => {
      await new Promise<void>((resolve) => {
        signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      return {
        status: 'cancelled',
        unresolvedRepos: [],
        unresolvedTargets: [],
        failedCommits: [],
      }
    })

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
        options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
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
    vi.spyOn(useReposStore.getState(), 'hydrateRepoSession').mockResolvedValue(undefined)

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

function Harness() {
  useAuthenticatedAppBootstrap()
  return null
}

function PublicHarness() {
  usePublicAppBootstrap()
  return null
}

function branchTargetKey(repoRoot: string, branchName: string): string {
  return workspacePaneTabsTargetIdentityKey({ repoRoot, branchName, worktreePath: null })
}
