// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  defaultClientWorkspaceState,
  defaultServerWorkspaceState,
  defaultSettingsSnapshot,
} from '#/shared/settings-defaults.ts'
import { flushMicrotasks, renderInJsdom } from '#/test-utils/render.tsx'
import { useAuthenticatedAppBootstrap } from '#/web/hooks/useAuthenticatedAppBootstrap.ts'
import { usePublicAppBootstrap } from '#/web/hooks/usePublicAppBootstrap.ts'
import { getExternalAppsSnapshot, getSettingsSnapshot } from '#/web/settings-client.ts'
import { restoreWorkspaceAtBoot } from '#/web/settings-actions.ts'
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
import type { ClientWorkspaceState, ServerWorkspaceState, WorkspaceRuntimeRestoreSnapshot } from '#/shared/api-types.ts'
import { readClientWorkspaceState } from '#/web/client-workspace-state.ts'

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
    restoreWorkspaceAtBoot: vi.fn(),
  }
})

vi.mock('#/web/client-workspace-state.ts', () => ({
  readClientWorkspaceState: vi.fn(),
}))

const mockedGetExternalAppsSnapshot = vi.mocked(getExternalAppsSnapshot)
const mockedGetSettingsSnapshot = vi.mocked(getSettingsSnapshot)
const mockedRestoreWorkspaceAtBoot = vi.mocked(restoreWorkspaceAtBoot)
const mockedReadClientWorkspaceState = vi.mocked(readClientWorkspaceState)

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
  mockedRestoreWorkspaceAtBoot.mockReset()
  mockServerRestore(defaultWorkspaceRestoreFixture())
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
    const targetKey = branchTargetKey('goblin+file:///tmp/repo', 'main')
    const session = workspaceRestoreFixture(
      {
        openWorkspaceEntries: [{ kind: 'local' as const, id: 'goblin+file:///tmp/repo' }],
        workspacePaneTabsByTargetByWorkspace: {
          'goblin+file:///tmp/repo': {
            [targetKey]: [],
          },
        },
      },
      {
        restoredRepoId: 'goblin+file:///tmp/repo',
        zenMode: false,
        workspacePaneSize: 45,
        selectedTerminalSessionIdByTerminalWorktree: { '/tmp/repo\0/tmp/worktree': 'term-222222222222222222222' },
        preferredWorkspacePaneTabByTargetByRepo: {},
        filetreeViewStateByWorktreeByRepo: {
          'goblin+file:///tmp/repo': {
            '/tmp/worktree': {
              selectedKeys: ['src/index.ts'],
              expandedKeys: ['src'],
              topVisibleRowIndex: 140,
            },
          },
        },
      },
    )
    const settings = defaultSettingsSnapshot()
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
      [filetreeInteractionScopeKey('goblin+file:///tmp/repo', '/tmp/worktree')]: {
        selectedKeys: ['src/index.ts'],
        expandedKeys: ['src'],
        topVisibleRowIndex: 140,
      },
    })
    expect(hydrateRestoredRuntime).toHaveBeenCalledWith(
      restoredRuntimeForWorkspace(session.serverWorkspace, session.clientWorkspace.restoredRepoId),
      {
        signal: expect.any(AbortSignal),
        restoredClientWorkspace: session.clientWorkspace,
      },
    )
    expect(hydrateTheme).toHaveBeenCalledWith(settings)
    expect(mockedGetSettingsSnapshot).toHaveBeenCalledTimes(1)
    expect(mockedGetExternalAppsSnapshot).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
    expect(primaryWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toEqual(settings)
    expect(primaryWindowQueryClient.getQueryData(externalAppsQueryKey())).toEqual(defaultExternalAppsSnapshot())
    expect(state.sessionPersistenceReady).toBe(true)
  })

  test('passes the routed repo root to server workspace restore', async () => {
    renderInJsdom(<Harness activeRepoRoot="goblin+file:///tmp/routed-repo" />)

    await vi.waitFor(() => {
      expect(mockedRestoreWorkspaceAtBoot).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          activeRepoRoot: 'goblin+file:///tmp/routed-repo',
          signal: expect.any(AbortSignal),
        }),
      )
    })
  })

  test('restores the boot session when non-critical authenticated hydrates fail', async () => {
    const session = workspaceRestoreFixture(
      {
        openWorkspaceEntries: [{ kind: 'local' as const, id: 'goblin+file:///tmp/repo' }],
      },
      {
        restoredRepoId: 'goblin+file:///tmp/repo',
        zenMode: true,
        workspacePaneSize: 55,
        selectedTerminalSessionIdByTerminalWorktree: {},
        preferredWorkspacePaneTabByTargetByRepo: {},
        filetreeViewStateByWorktreeByRepo: {},
      },
    )
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
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

    expect(hydrateRestoredRuntime).toHaveBeenCalledWith(
      restoredRuntimeForWorkspace(session.serverWorkspace, session.clientWorkspace.restoredRepoId),
      {
        signal: expect.any(AbortSignal),
        restoredClientWorkspace: session.clientWorkspace,
      },
    )
    expect(useReposStore.getState().workspacePaneSize).toBe(55)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(true)
    expect(mockedGetSettingsSnapshot).toHaveBeenCalledTimes(1)
  })

  test('blocks persistence when server workspace restore fails', async () => {
    const session = workspaceRestoreFixture(
      {
        openWorkspaceEntries: [{ kind: 'local' as const, id: 'goblin+file:///tmp/repo' }],
      },
      {
        restoredRepoId: 'goblin+file:///tmp/repo',
        zenMode: true,
        workspacePaneSize: 55,
        selectedTerminalSessionIdByTerminalWorktree: {},
        preferredWorkspacePaneTabByTargetByRepo: {},
        filetreeViewStateByWorktreeByRepo: {},
      },
    )
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
    mockedRestoreWorkspaceAtBoot.mockRejectedValue(new Error('server workspace restore failed'))
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const hydrateRestoredRuntime = vi
      .spyOn(useReposStore.getState(), 'hydrateRestoredWorkspaceRuntime')
      .mockResolvedValue(undefined)

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(useReposStore.getState().sessionRestoreError).toBe('server workspace restore failed')
    })

    expect(useReposStore.getState().workspaceMembershipReady).toBe(false)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(false)
    expect(useReposStore.getState().sessionRestoreError).toBe('server workspace restore failed')
    expect(hydrateRestoredRuntime).not.toHaveBeenCalled()
  })

  test('continues with a repaired session returned by server restore', async () => {
    const persistedSession = workspaceRestoreFixture(
      {
        openWorkspaceEntries: [{ kind: 'local' as const, id: 'goblin+file:///tmp/repo' }],
      },
      {
        restoredRepoId: 'goblin+file:///tmp/repo',
        zenMode: true,
        workspacePaneSize: 55,
        selectedTerminalSessionIdByTerminalWorktree: {},
        preferredWorkspacePaneTabByTargetByRepo: {
          'goblin+file:///tmp/repo': {
            [branchTargetKey('goblin+file:///tmp/repo', 'main')]: 'files' as const,
          },
        },
        filetreeViewStateByWorktreeByRepo: {},
      },
    )
    const rebuiltSession = workspaceRestoreFixture(persistedSession.serverWorkspace, {
      ...persistedSession.clientWorkspace,
      preferredWorkspacePaneTabByTargetByRepo: {},
    })
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
    mockedRestoreWorkspaceAtBoot.mockResolvedValue({
      status: 'repaired',
      openWorkspaceEntries: rebuiltSession.serverWorkspace.openWorkspaceEntries,
      runtime: restoredRuntimeForWorkspace(
        rebuiltSession.serverWorkspace,
        rebuiltSession.clientWorkspace.restoredRepoId,
      ),
    })
    mockClientPresentation(rebuiltSession.clientWorkspace)
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

    expect(hydrateRestoredRuntime).toHaveBeenCalledWith(
      restoredRuntimeForWorkspace(rebuiltSession.serverWorkspace, rebuiltSession.clientWorkspace.restoredRepoId),
      {
        signal: expect.any(AbortSignal),
        restoredClientWorkspace: rebuiltSession.clientWorkspace,
      },
    )
    expect(primaryWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).not.toHaveProperty('session')
    expect(useReposStore.getState().sessionRestoreError).toBeNull()
  })

  test('blocks persistence when repo session hydration fails', async () => {
    const session = workspaceRestoreFixture(
      {
        openWorkspaceEntries: [{ kind: 'local' as const, id: 'goblin+file:///tmp/missing-repo' }],
      },
      {
        restoredRepoId: 'goblin+file:///tmp/missing-repo',
        zenMode: true,
        workspacePaneSize: 55,
        selectedTerminalSessionIdByTerminalWorktree: {},
        preferredWorkspacePaneTabByTargetByRepo: {},
        filetreeViewStateByWorktreeByRepo: {},
      },
    )
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
    mockServerRestore(session)
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useReposStore.getState(), 'hydrateRestoredWorkspaceRuntime').mockRejectedValue(
      new Error('session repo restore failed'),
    )

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(useReposStore.getState().sessionRestoreError).toBe('session repo restore failed')
    })

    expect(useReposStore.getState().workspaceMembershipReady).toBe(false)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(false)
    expect(useReposStore.getState().sessionRestoreError).toBe('session repo restore failed')
  })

  test('blocks persistence and enters an explicit failed state when boot session restore fails', async () => {
    mockedGetSettingsSnapshot.mockRejectedValue(new Error('settings unavailable'))

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(useReposStore.getState().sessionRestoreError).toBe('settings unavailable')
    })

    expect(useReposStore.getState().workspaceMembershipReady).toBe(false)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(false)
    expect(useReposStore.getState().sessionRestoreError).toBe('settings unavailable')
  })

  test('retries the complete bootstrap workflow after an explicit failure', async () => {
    mockedGetSettingsSnapshot
      .mockRejectedValueOnce(new Error('settings unavailable'))
      .mockResolvedValueOnce(defaultSettingsSnapshot())

    const result = renderInJsdom(<Harness />)
    await vi.waitFor(() => expect(result.container.textContent).toBe('settings unavailable'))

    result.container.querySelector('button')?.click()

    await vi.waitFor(() => expect(result.container.textContent).toBe('ready'))
    expect(mockedGetSettingsSnapshot).toHaveBeenCalledTimes(2)
    expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(true)
    expect(useReposStore.getState().sessionRestoreError).toBeNull()
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
    expect(useReposStore.getState().workspaceMembershipReady).toBe(false)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(false)
    expect(useReposStore.getState().sessionRestoreError).toBe('authenticated workspace restore timed out after 30000ms')
  })

  test('reports timeout when server workspace restore does not return after abort', async () => {
    vi.useFakeTimers()
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useReposStore.getState(), 'hydrateRestoredWorkspaceRuntime').mockResolvedValue(undefined)
    mockedRestoreWorkspaceAtBoot.mockImplementation(() => new Promise(() => {}))

    renderInJsdom(<Harness />)
    await flushMicrotasks(3)
    await vi.advanceTimersByTimeAsync(30_000)
    await flushMicrotasks(3)

    expect(useReposStore.getState().workspaceMembershipReady).toBe(false)
    expect(useReposStore.getState().sessionPersistenceReady).toBe(false)
    expect(useReposStore.getState().sessionRestoreError).toBe('authenticated workspace restore timed out after 30000ms')
  })

  test('reports timeout when repo session hydration does not return after abort', async () => {
    vi.useFakeTimers()
    const session = workspaceRestoreFixture(
      {
        openWorkspaceEntries: [{ kind: 'local' as const, id: 'goblin+file:///tmp/repo' }],
      },
      {
        restoredRepoId: 'goblin+file:///tmp/repo',
        zenMode: true,
        workspacePaneSize: 55,
        selectedTerminalSessionIdByTerminalWorktree: {},
        preferredWorkspacePaneTabByTargetByRepo: {},
        filetreeViewStateByWorktreeByRepo: {},
      },
    )
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
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

    expect(useReposStore.getState().workspaceMembershipReady).toBe(false)
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

  test('subscribes i18n invalidation without refetching public bootstrap state', async () => {
    const hydrateI18n = vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const subscribeI18n = vi.spyOn(useI18nStore.getState(), 'subscribeInvalidation').mockImplementation(() => {})
    const hydrateHostInfo = vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useReposStore.getState(), 'hydrateRestoredWorkspaceRuntime').mockResolvedValue(undefined)

    renderInJsdom(<Harness />)
    await flushMicrotasks(2)

    expect(subscribeI18n).toHaveBeenCalledTimes(1)
    expect(hydrateI18n).not.toHaveBeenCalled()
    expect(hydrateHostInfo).not.toHaveBeenCalled()
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
  const bootstrap = useAuthenticatedAppBootstrap({ activeRepoRoot })
  return bootstrap.state.status === 'failed' ? (
    <button onClick={bootstrap.retry}>{bootstrap.state.message}</button>
  ) : (
    <div>{bootstrap.state.status}</div>
  )
}

function PublicHarness() {
  usePublicAppBootstrap()
  return null
}

interface WorkspaceRestoreFixture {
  serverWorkspace: ServerWorkspaceState
  clientWorkspace: ClientWorkspaceState
}

function defaultWorkspaceRestoreFixture(): WorkspaceRestoreFixture {
  return {
    serverWorkspace: defaultServerWorkspaceState(),
    clientWorkspace: defaultClientWorkspaceState(),
  }
}

function workspaceRestoreFixture(
  serverWorkspace: Partial<ServerWorkspaceState>,
  clientWorkspace: Partial<ClientWorkspaceState>,
): WorkspaceRestoreFixture {
  return {
    serverWorkspace: { ...defaultServerWorkspaceState(), ...serverWorkspace },
    clientWorkspace: { ...defaultClientWorkspaceState(), ...clientWorkspace },
  }
}

function mockServerRestore(fixture: WorkspaceRestoreFixture): void {
  const { serverWorkspace, clientWorkspace } = fixture
  mockedRestoreWorkspaceAtBoot.mockResolvedValue({
    status: 'restored',
    openWorkspaceEntries: serverWorkspace.openWorkspaceEntries,
    runtime: restoredRuntimeForWorkspace(serverWorkspace, clientWorkspace.restoredRepoId),
  })
  mockClientPresentation(clientWorkspace)
}

function mockClientPresentation(clientWorkspace: ClientWorkspaceState): void {
  mockedReadClientWorkspaceState.mockResolvedValue(clientWorkspace)
}

function restoredRuntimeForWorkspace(
  serverWorkspace: ServerWorkspaceState,
  restoredRepoId: string | null,
): WorkspaceRuntimeRestoreSnapshot {
  return {
    repos: serverWorkspace.openWorkspaceEntries.map((entry) => ({
      entry,
      repoRoot: entry.id,
      repoRuntimeId: `repo-runtime-${entry.id}`,
      name: entry.id.split('/').pop() || entry.id,
      workspaceProbe: {
        status: 'ready',
        name: entry.id.split('/').pop() || entry.id,
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
        },
        diagnostics: [],
      },
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
    restoredRepoId,
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
