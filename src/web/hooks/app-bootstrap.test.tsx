// @vitest-environment jsdom

import { defineComponent } from 'vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { advanceTimersAndFlush, useFakeTimers } from '#/test-utils/timers.ts'
import {
  defaultClientWorkspaceState,
  defaultServerWorkspaceState,
  defaultSettingsSnapshot,
} from '#/shared/settings-defaults.ts'
import { flushMicrotasks } from '#/test-utils/microtasks.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useAuthenticatedAppBootstrap } from '#/web/hooks/useAuthenticatedAppBootstrap.ts'
import { getExternalAppsSnapshot, getI18nSnapshot, getSettingsSnapshot } from '#/web/settings-client.ts'
import { restoreWorkspaceAtBoot } from '#/web/settings-actions.ts'
import { isRemoteWorkspaceId, normalizeRemoteWorkspaceRef, parseRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import { hostInfoStore } from '#/web/stores/host-info.ts'
import { i18nStore } from '#/web/stores/i18n.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  filetreeInteractionScopeKey,
  resetFiletreeInteractionStore,
  filetreeInteractionStore,
} from '#/web/stores/workspaces/filetree-interaction-state.ts'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { themeStore } from '#/web/stores/theme.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { externalAppsQueryKey, settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import type {
  ClientWorkspaceState,
  ServerWorkspaceState,
  SettingsSnapshot,
  WorkspaceRuntimeRestoreSnapshot,
} from '#/shared/api-types.ts'
import { readClientWorkspaceState, writeClientWorkspaceState } from '#/web/client-workspace-state.ts'
import { useClientWorkspacePersistence } from '#/web/hooks/useClientWorkspacePersistence.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { bootstrapLog } from '#/web/logger.ts'

vi.mock('#/web/settings-client.ts', () => ({
  getExternalAppsSnapshot: vi.fn(),
  getI18nSnapshot: vi.fn(),
  getSettingsSnapshot: vi.fn(),
}))

vi.mock('#/web/settings-actions.ts', () => ({
  restoreWorkspaceAtBoot: vi.fn(),
}))

vi.mock('#/web/client-workspace-state.ts', () => ({
  readClientWorkspaceState: vi.fn(),
  writeClientWorkspaceState: vi.fn(),
}))

const mockedGetExternalAppsSnapshot = vi.mocked(getExternalAppsSnapshot)
const mockedGetI18nSnapshot = vi.mocked(getI18nSnapshot)
const mockedGetSettingsSnapshot = vi.mocked(getSettingsSnapshot)
const mockedRestoreWorkspaceAtBoot = vi.mocked(restoreWorkspaceAtBoot)
const mockedReadClientWorkspaceState = vi.mocked(readClientWorkspaceState)
const mockedWriteClientWorkspaceState = vi.mocked(writeClientWorkspaceState)

beforeEach(() => {
  resetWorkspacesStore()
  resetFiletreeInteractionStore()
  appQueryClient.clear()
  vi.restoreAllMocks()
  mockedGetExternalAppsSnapshot.mockReset()
  mockedGetExternalAppsSnapshot.mockResolvedValue(defaultExternalAppsSnapshot())
  mockedGetI18nSnapshot.mockReset()
  mockedGetI18nSnapshot.mockResolvedValue({ lang: 'en', pref: 'auto', dict: {} })
  mockedGetSettingsSnapshot.mockReset()
  const settings = defaultSettingsSnapshot()
  mockedGetSettingsSnapshot.mockResolvedValue(settings)
  mockedRestoreWorkspaceAtBoot.mockReset()
  mockedWriteClientWorkspaceState.mockReset()
  mockedWriteClientWorkspaceState.mockResolvedValue(undefined)
  mockServerRestore(defaultWorkspaceRestoreFixture())
})

describe('app bootstrap hooks', () => {
  test('canonicalizes boot session pane state before applying it to the repos store', async () => {
    const targetKey = branchTargetKey('goblin+file:///tmp/repo', 'main')
    const session = workspaceRestoreFixture(
      {
        openWorkspaceEntries: [{ id: workspaceIdForTest('goblin+file:///tmp/repo') }],
        workspacePaneTabsByTargetByWorkspace: {
          'goblin+file:///tmp/repo': {
            [targetKey]: [],
          },
        },
      },
      {
        restoredWorkspaceId: workspaceIdForTest('goblin+file:///tmp/repo'),
        zenMode: false,
        workspacePaneSize: 45,
        selectedTerminalSessionIdByTerminalFilesystemTarget: {
          'goblin+file:///tmp/repo\0goblin+file:///tmp/worktree': 'term-222222222222222222222',
        },
        branchViewModeByWorkspace: { 'goblin+file:///tmp/repo': 'worktrees' },
        preferredWorkspacePaneTabByTargetByWorkspace: {},
        filetreeViewStateByFilesystemTargetByWorkspace: {
          'goblin+file:///tmp/repo': {
            'goblin+file:///tmp/worktree': {
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
    const hydrateTheme = vi.spyOn(themeStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(i18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(hostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const hydrateRestoredRuntime = vi
      .spyOn(workspacesStore.getState(), 'hydrateRestoredWorkspaceRuntime')
      .mockResolvedValue(undefined)

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(hydrateRestoredRuntime).toHaveBeenCalled()
    })

    const state = workspacesStore.getState()
    expect(state.zenMode).toBe(false)
    expect(state.workspacePaneSize).toBe(45)
    expect(state.selectedTerminalSessionIdByTerminalFilesystemTarget).toEqual({
      'goblin+file:///tmp/repo\0goblin+file:///tmp/worktree': 'term-222222222222222222222',
    })
    expect(state.branchViewModeByWorkspace).toEqual({ 'goblin+file:///tmp/repo': 'worktrees' })
    expect(filetreeInteractionStore.getState().interactionByScope).toMatchObject({
      [filetreeInteractionScopeKey(workspaceIdForTest('goblin+file:///tmp/repo'), '/tmp/worktree')]: {
        selectedKeys: ['src/index.ts'],
        expandedKeys: ['src'],
        topVisibleRowIndex: 140,
      },
    })
    expect(hydrateRestoredRuntime).toHaveBeenCalledWith(
      restoredRuntimeForWorkspace(session.serverWorkspace, session.clientWorkspace.restoredWorkspaceId),
      {
        signal: expect.any(AbortSignal),
        restoredClientWorkspace: session.clientWorkspace,
      },
    )
    expect(hydrateTheme).toHaveBeenCalledOnce()
    expect(hydrateTheme).toHaveBeenCalledWith()
    expect(mockedGetSettingsSnapshot).toHaveBeenCalledTimes(1)
    expect(mockedGetExternalAppsSnapshot).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
    expect(appQueryClient.getQueryData(settingsSnapshotQueryKey())).toEqual(settings)
    expect(appQueryClient.getQueryData(externalAppsQueryKey())).toEqual(defaultExternalAppsSnapshot())
    expect(state.sessionPersistenceReady).toBe(true)
  })

  test('passes the routed repo root to server workspace restore', async () => {
    renderInJsdom(<Harness activeWorkspaceId={workspaceIdForTest('goblin+file:///tmp/routed-repo')} />)

    await vi.waitFor(() => {
      expect(mockedRestoreWorkspaceAtBoot).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          activeWorkspaceId: 'goblin+file:///tmp/routed-repo',
          signal: expect.any(AbortSignal),
        }),
      )
    })
  })

  test('restores the boot session when non-critical authenticated hydrates fail', async () => {
    const session = workspaceRestoreFixture(
      {
        openWorkspaceEntries: [{ id: workspaceIdForTest('goblin+file:///tmp/repo') }],
      },
      {
        restoredWorkspaceId: workspaceIdForTest('goblin+file:///tmp/repo'),
        zenMode: true,
        workspacePaneSize: 55,
        selectedTerminalSessionIdByTerminalFilesystemTarget: {},
        preferredWorkspacePaneTabByTargetByWorkspace: {},
        filetreeViewStateByFilesystemTargetByWorkspace: {},
      },
    )
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
    mockServerRestore(session)
    vi.spyOn(themeStore.getState(), 'hydrate').mockRejectedValue(new Error('theme unavailable'))
    vi.spyOn(i18nStore.getState(), 'hydrate').mockRejectedValue(new Error('i18n unavailable'))
    vi.spyOn(hostInfoStore.getState(), 'hydrate').mockRejectedValue(new Error('host unavailable'))
    const hydrateRestoredRuntime = vi
      .spyOn(workspacesStore.getState(), 'hydrateRestoredWorkspaceRuntime')
      .mockResolvedValue(undefined)

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(hydrateRestoredRuntime).toHaveBeenCalled()
    })

    expect(hydrateRestoredRuntime).toHaveBeenCalledWith(
      restoredRuntimeForWorkspace(session.serverWorkspace, session.clientWorkspace.restoredWorkspaceId),
      {
        signal: expect.any(AbortSignal),
        restoredClientWorkspace: session.clientWorkspace,
      },
    )
    expect(workspacesStore.getState().workspacePaneSize).toBe(55)
    expect(workspacesStore.getState().sessionPersistenceReady).toBe(true)
    expect(mockedGetSettingsSnapshot).toHaveBeenCalledTimes(1)
  })

  test('blocks persistence when server workspace restore fails', async () => {
    const session = workspaceRestoreFixture(
      {
        openWorkspaceEntries: [{ id: workspaceIdForTest('goblin+file:///tmp/repo') }],
      },
      {
        restoredWorkspaceId: workspaceIdForTest('goblin+file:///tmp/repo'),
        zenMode: true,
        workspacePaneSize: 55,
        selectedTerminalSessionIdByTerminalFilesystemTarget: {},
        preferredWorkspacePaneTabByTargetByWorkspace: {},
        filetreeViewStateByFilesystemTargetByWorkspace: {},
      },
    )
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
    mockedRestoreWorkspaceAtBoot.mockRejectedValue(new Error('server workspace restore failed'))
    vi.spyOn(themeStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(i18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(hostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const hydrateRestoredRuntime = vi
      .spyOn(workspacesStore.getState(), 'hydrateRestoredWorkspaceRuntime')
      .mockResolvedValue(undefined)

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(workspacesStore.getState().sessionRestoreError).toBe('server workspace restore failed')
    })

    expect(workspacesStore.getState().workspaceMembershipReady).toBe(false)
    expect(workspacesStore.getState().sessionPersistenceReady).toBe(false)
    expect(mockedWriteClientWorkspaceState).not.toHaveBeenCalled()
    expect(workspacesStore.getState().sessionRestoreError).toBe('server workspace restore failed')
    expect(hydrateRestoredRuntime).not.toHaveBeenCalled()
  })

  test('continues with a repaired session returned by server restore', async () => {
    const persistedSession = workspaceRestoreFixture(
      {
        openWorkspaceEntries: [{ id: workspaceIdForTest('goblin+file:///tmp/repo') }],
      },
      {
        restoredWorkspaceId: workspaceIdForTest('goblin+file:///tmp/repo'),
        zenMode: true,
        workspacePaneSize: 55,
        selectedTerminalSessionIdByTerminalFilesystemTarget: {},
        preferredWorkspacePaneTabByTargetByWorkspace: {
          'goblin+file:///tmp/repo': {
            [branchTargetKey('goblin+file:///tmp/repo', 'main')]: 'files' as const,
          },
        },
        filetreeViewStateByFilesystemTargetByWorkspace: {},
      },
    )
    const rebuiltSession = workspaceRestoreFixture(persistedSession.serverWorkspace, {
      ...persistedSession.clientWorkspace,
      preferredWorkspacePaneTabByTargetByWorkspace: {},
    })
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
    mockedRestoreWorkspaceAtBoot.mockResolvedValue({
      status: 'repaired',
      openWorkspaceEntries: rebuiltSession.serverWorkspace.openWorkspaceEntries,
      runtime: restoredRuntimeForWorkspace(
        rebuiltSession.serverWorkspace,
        rebuiltSession.clientWorkspace.restoredWorkspaceId,
      ),
    })
    mockClientPresentation(rebuiltSession.clientWorkspace)
    vi.spyOn(themeStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(i18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(hostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const hydrateRestoredRuntime = vi
      .spyOn(workspacesStore.getState(), 'hydrateRestoredWorkspaceRuntime')
      .mockResolvedValue(undefined)

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(workspacesStore.getState().sessionPersistenceReady).toBe(true)
    })

    expect(hydrateRestoredRuntime).toHaveBeenCalledWith(
      restoredRuntimeForWorkspace(rebuiltSession.serverWorkspace, rebuiltSession.clientWorkspace.restoredWorkspaceId),
      {
        signal: expect.any(AbortSignal),
        restoredClientWorkspace: rebuiltSession.clientWorkspace,
      },
    )
    expect(appQueryClient.getQueryData(settingsSnapshotQueryKey())).not.toHaveProperty('session')
    expect(workspacesStore.getState().sessionRestoreError).toBeNull()
  })

  test('keeps client persistence closed after a workspace-state read failure and opens it after retry', async () => {
    const readError = new Error('corrupt client workspace state')
    mockedReadClientWorkspaceState.mockRejectedValueOnce(readError).mockResolvedValueOnce(defaultClientWorkspaceState())

    const result = renderInJsdom(<PersistenceHarness />)
    await vi.waitFor(() => expect(result.container.textContent).toBe(readError.message))

    expect(workspacesStore.getState().workspaceMembershipReady).toBe(false)
    expect(workspacesStore.getState().sessionPersistenceReady).toBe(false)

    await flushTestUpdates(async () => {
      result.container.querySelector('button')?.click()
    })
    await vi.waitFor(() => expect(result.container.textContent).toBe('ready'))

    expect(workspacesStore.getState().workspaceMembershipReady).toBe(true)
    expect(workspacesStore.getState().sessionPersistenceReady).toBe(true)
    await vi.waitFor(() => expect(mockedWriteClientWorkspaceState).toHaveBeenCalled())
  })

  test('blocks persistence when repo session hydration fails', async () => {
    const session = workspaceRestoreFixture(
      {
        openWorkspaceEntries: [{ id: workspaceIdForTest('goblin+file:///tmp/missing-repo') }],
      },
      {
        restoredWorkspaceId: workspaceIdForTest('goblin+file:///tmp/missing-repo'),
        zenMode: true,
        workspacePaneSize: 55,
        selectedTerminalSessionIdByTerminalFilesystemTarget: {},
        preferredWorkspacePaneTabByTargetByWorkspace: {},
        filetreeViewStateByFilesystemTargetByWorkspace: {},
      },
    )
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
    mockServerRestore(session)
    vi.spyOn(themeStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(i18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(hostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(workspacesStore.getState(), 'hydrateRestoredWorkspaceRuntime').mockRejectedValue(
      new Error('session repo restore failed'),
    )

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(workspacesStore.getState().sessionRestoreError).toBe('session repo restore failed')
    })

    expect(workspacesStore.getState().workspaceMembershipReady).toBe(false)
    expect(workspacesStore.getState().sessionPersistenceReady).toBe(false)
    expect(workspacesStore.getState().sessionRestoreError).toBe('session repo restore failed')
  })

  test('blocks persistence and enters an explicit failed state when boot session restore fails', async () => {
    mockedGetSettingsSnapshot.mockRejectedValue(new Error('settings unavailable'))

    renderInJsdom(<Harness />)
    await vi.waitFor(() => {
      expect(workspacesStore.getState().sessionRestoreError).toBe('settings unavailable')
    })

    expect(workspacesStore.getState().workspaceMembershipReady).toBe(false)
    expect(workspacesStore.getState().sessionPersistenceReady).toBe(false)
    expect(workspacesStore.getState().sessionRestoreError).toBe('settings unavailable')
  })

  test('retries the complete bootstrap workflow after an explicit failure', async () => {
    mockedGetSettingsSnapshot
      .mockRejectedValueOnce(new Error('settings unavailable'))
      .mockResolvedValueOnce(defaultSettingsSnapshot())

    const result = renderInJsdom(<Harness />)
    await vi.waitFor(() => expect(result.container.textContent).toBe('settings unavailable'))

    await flushTestUpdates(async () => {
      result.container.querySelector('button')?.click()
    })

    await vi.waitFor(() => expect(result.container.textContent).toBe('ready'))
    expect(mockedGetSettingsSnapshot).toHaveBeenCalledTimes(2)
    expect(workspacesStore.getState().workspaceMembershipReady).toBe(true)
    expect(workspacesStore.getState().sessionPersistenceReady).toBe(true)
    expect(workspacesStore.getState().sessionRestoreError).toBeNull()
  })

  test('times out authenticated workspace restore when settings hangs', async () => {
    useFakeTimers()
    mockedGetSettingsSnapshot.mockImplementation(({ signal }: { signal?: AbortSignal } = {}) => {
      return new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    renderInJsdom(<Harness />)

    await advanceTimersAndFlush(30_000)

    expect(mockedGetSettingsSnapshot).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
    expect(workspacesStore.getState().workspaceMembershipReady).toBe(false)
    expect(workspacesStore.getState().sessionPersistenceReady).toBe(false)
    expect(workspacesStore.getState().sessionRestoreError).toBe(
      'authenticated workspace restore timed out after 30000ms',
    )
  })

  test('cancels a timed-out shared query so retry starts fresh work', async () => {
    useFakeTimers()
    mockedGetSettingsSnapshot.mockImplementationOnce(({ signal }: { signal?: AbortSignal } = {}) => {
      return new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    mockedGetSettingsSnapshot.mockResolvedValueOnce(defaultSettingsSnapshot())
    const result = renderInJsdom(<Harness />)

    await vi.advanceTimersByTimeAsync(30_000)
    vi.useRealTimers()
    await vi.waitFor(() =>
      expect(result.container.textContent).toBe('authenticated workspace restore timed out after 30000ms'),
    )
    await flushTestUpdates(async () => {
      result.container.querySelector('button')?.click()
    })

    await vi.waitFor(() => expect(result.container.textContent).toBe('ready'))
    expect(mockedGetSettingsSnapshot).toHaveBeenCalledTimes(2)
  })

  test('reports timeout when server workspace restore does not return after abort', async () => {
    useFakeTimers()
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
    vi.spyOn(themeStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(i18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(hostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(workspacesStore.getState(), 'hydrateRestoredWorkspaceRuntime').mockResolvedValue(undefined)
    mockedRestoreWorkspaceAtBoot.mockImplementation(() => new Promise(() => {}))

    renderInJsdom(<Harness />)
    await flushMicrotasks(3)
    await advanceTimersAndFlush(30_000)

    expect(workspacesStore.getState().workspaceMembershipReady).toBe(false)
    expect(workspacesStore.getState().sessionPersistenceReady).toBe(false)
    expect(workspacesStore.getState().sessionRestoreError).toBe(
      'authenticated workspace restore timed out after 30000ms',
    )
  })

  test('reports timeout when repo session hydration does not return after abort', async () => {
    useFakeTimers()
    const session = workspaceRestoreFixture(
      {
        openWorkspaceEntries: [{ id: workspaceIdForTest('goblin+file:///tmp/repo') }],
      },
      {
        restoredWorkspaceId: workspaceIdForTest('goblin+file:///tmp/repo'),
        zenMode: true,
        workspacePaneSize: 55,
        selectedTerminalSessionIdByTerminalFilesystemTarget: {},
        preferredWorkspacePaneTabByTargetByWorkspace: {},
        filetreeViewStateByFilesystemTargetByWorkspace: {},
      },
    )
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
    mockServerRestore(session)
    vi.spyOn(themeStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(i18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(hostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(workspacesStore.getState(), 'hydrateRestoredWorkspaceRuntime').mockImplementation(
      () => new Promise(() => {}),
    )

    renderInJsdom(<Harness />)
    await flushMicrotasks(3)
    await advanceTimersAndFlush(30_000)

    expect(workspacesStore.getState().workspaceMembershipReady).toBe(false)
    expect(workspacesStore.getState().sessionPersistenceReady).toBe(false)
    expect(workspacesStore.getState().sessionRestoreError).toBe(
      'authenticated workspace restore timed out after 30000ms',
    )
  })

  test('stops waiting on unmount without cancelling the shared settings query', async () => {
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

    expect(signal?.aborted).toBe(false)
    expect(workspacesStore.getState().workspaceMembershipReady).toBe(false)
    expect(workspacesStore.getState().sessionRestoreError).toBeNull()
  })

  test('subscribes i18n invalidation without refetching public bootstrap state', async () => {
    const hydrateI18n = vi.spyOn(i18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const subscribeI18n = vi.spyOn(i18nStore.getState(), 'subscribeInvalidation').mockImplementation(() => {})
    const hydrateHostInfo = vi.spyOn(hostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(themeStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(workspacesStore.getState(), 'hydrateRestoredWorkspaceRuntime').mockResolvedValue(undefined)

    renderInJsdom(<Harness />)
    await flushMicrotasks(2)

    expect(subscribeI18n).toHaveBeenCalledTimes(1)
    expect(hydrateI18n).not.toHaveBeenCalled()
    expect(hydrateHostInfo).not.toHaveBeenCalled()
  })

  test('admits theme hydration before the shared settings snapshot resolves', async () => {
    const settings = Promise.withResolvers<SettingsSnapshot>()
    mockedGetSettingsSnapshot.mockImplementation(async () => await settings.promise)
    const hydrateTheme = vi.spyOn(themeStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(i18nStore.getState(), 'subscribeInvalidation').mockImplementation(() => {})

    renderInJsdom(<Harness />)
    await flushMicrotasks(2)

    expect(hydrateTheme).toHaveBeenCalledOnce()
    settings.resolve(defaultSettingsSnapshot())
  })

  test('shares the settings query across an interrupted mount', async () => {
    const settings = Promise.withResolvers<SettingsSnapshot>()
    const externalApps = Promise.withResolvers<ReturnType<typeof defaultExternalAppsSnapshot>>()
    let settingsSignal: AbortSignal | undefined
    let externalAppsSignal: AbortSignal | undefined
    mockedGetSettingsSnapshot.mockImplementation((options: { signal?: AbortSignal } = {}) => {
      settingsSignal = options.signal
      return settings.promise
    })
    mockedGetExternalAppsSnapshot.mockImplementation((options: { signal?: AbortSignal } = {}) => {
      externalAppsSignal = options.signal
      return externalApps.promise
    })
    vi.spyOn(themeStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(i18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(hostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(workspacesStore.getState(), 'hydrateRestoredWorkspaceRuntime').mockResolvedValue(undefined)
    const warn = vi.spyOn(bootstrapLog, 'warn')

    const firstMount = renderInJsdom(<Harness />)
    await flushMicrotasks(1)
    firstMount.unmount()
    renderInJsdom(<Harness />)
    settings.resolve(defaultSettingsSnapshot())
    externalApps.resolve(defaultExternalAppsSnapshot())

    await vi.waitFor(() => {
      expect(workspacesStore.getState().sessionPersistenceReady).toBe(true)
    })

    expect(mockedGetSettingsSnapshot).toHaveBeenCalledTimes(1)
    expect(mockedGetExternalAppsSnapshot).toHaveBeenCalledTimes(1)
    expect(settingsSignal?.aborted).toBe(false)
    expect(externalAppsSignal?.aborted).toBe(false)
    expect(workspacesStore.getState().sessionPersistenceReady).toBe(true)
    expect(workspacesStore.getState().sessionRestoreError).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })
})

const Harness = defineComponent<{ activeWorkspaceId?: WorkspaceId | null }>({
  name: 'AuthenticatedAppBootstrapHarness',
  props: ['activeWorkspaceId'],
  setup(props) {
    const bootstrap = useAuthenticatedAppBootstrap({ activeWorkspaceId: () => props.activeWorkspaceId })
    return () =>
      bootstrap.state.value.status === 'failed' ? (
        <button onClick={bootstrap.retry}>{bootstrap.state.value.message}</button>
      ) : (
        <div>{bootstrap.state.value.status}</div>
      )
  },
})

const PersistenceHarness = defineComponent({
  name: 'AuthenticatedAppPersistenceHarness',
  setup() {
    const bootstrap = useAuthenticatedAppBootstrap()
    useClientWorkspacePersistence({ routedWorkspaceId: null })
    return () =>
      bootstrap.state.value.status === 'failed' ? (
        <button onClick={bootstrap.retry}>{bootstrap.state.value.message}</button>
      ) : (
        <div>{bootstrap.state.value.status}</div>
      )
  },
})

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
    runtime: restoredRuntimeForWorkspace(serverWorkspace, clientWorkspace.restoredWorkspaceId),
  })
  mockClientPresentation(clientWorkspace)
}

function mockClientPresentation(clientWorkspace: ClientWorkspaceState): void {
  mockedReadClientWorkspaceState.mockResolvedValue(clientWorkspace)
}

function restoredRuntimeForWorkspace(
  serverWorkspace: ServerWorkspaceState,
  restoredWorkspaceId: string | null,
): WorkspaceRuntimeRestoreSnapshot {
  const restoredWorkspace = restoredWorkspaceId ? workspaceIdForTest(restoredWorkspaceId) : null
  return {
    workspaces: serverWorkspace.openWorkspaceEntries.map((entry) => {
      const remoteRef = isRemoteWorkspaceId(entry.id)
        ? normalizeRemoteWorkspaceRef(parseRemoteWorkspaceId(entry.id))
        : null
      return {
        entry,
        ...(remoteRef
          ? {
              transport: {
                kind: 'ssh' as const,
                lifecycle: {
                  kind: 'ready' as const,
                  attemptId: 1,
                  target: { ...remoteRef, host: 'example.test', user: 'developer', port: 22 },
                },
              },
            }
          : { transport: { kind: 'file' as const } }),
        workspaceId: workspaceIdForTest(entry.id),
        workspaceRuntimeId: `repo-runtime-${entry.id}`,
        workspaceProbe: {
          status: 'ready',
          capabilities: {
            files: { read: true, write: true },
            terminal: { available: true },
            git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
          },
          diagnostics: [],
        },
        repoSnapshot: {
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
          remote: {
            remotes: [],
            hasRemotes: false,
            hasBrowserRemote: false,
            remoteProviders: {},
            hasGitHubRemote: false,
          },
        },
      }
    }),
    workspacePaneTabs: [],
    restoredWorkspaceId: restoredWorkspace,
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

function branchTargetKey(workspaceId: string, branchName: string): string {
  return workspacePaneTabsTargetIdentityKey({
    kind: 'git-branch',
    workspaceId: workspaceIdForTest(workspaceId),
    branchName,
  })
}
