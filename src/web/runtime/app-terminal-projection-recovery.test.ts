import { describe, expect, test, vi } from 'vitest'
import type { TerminalSessionsSnapshot } from '#/shared/terminal-types.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { AppTerminalProjectionRecovery } from '#/web/runtime/app-terminal-projection-recovery.ts'
import { RuntimeProjectionScope } from '#/web/runtime/runtime-projection-scope.ts'

const TARGET = {
  workspaceId: workspaceIdForTest('goblin+file:///workspace'),
  workspaceRuntimeId: 'workspace-runtime-current',
}

describe('AppTerminalProjectionRecovery', () => {
  test('accepts a server catalog and marks the active runtime ready', async () => {
    const reconcile = vi.fn(() => true)
    const markReady = vi.fn()
    const recovery = new AppTerminalProjectionRecovery({
      projection: {
        reconcileServerSessionsSnapshot: reconcile,
        resynchronizeConnectedViews: vi.fn(),
        terminalSessionsCatalogCoverageRevision: vi.fn(() => 2),
      },
      readClientId: () => 'client-test',
      recoverSessions: async () => ({ revision: 2, sessions: [] }),
      hydrationEntry: () => ({ workspaceRuntimeId: TARGET.workspaceRuntimeId, phase: 'pending' }),
      beginHydration: vi.fn(),
      markReady,
      markFailed: vi.fn(),
      isFocusRefreshDue: () => true,
      logFailure: vi.fn(),
    })
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    recovery.request(scope, { kind: 'minimum-revision', revision: 0 })

    await vi.waitFor(() => expect(markReady).toHaveBeenCalledWith(TARGET.workspaceId, TARGET.workspaceRuntimeId))
    expect(reconcile).toHaveBeenCalledWith(TARGET, { revision: 2, sessions: [] }, 'client-test')
  })

  test('records an initial recovery failure only while hydration is pending', async () => {
    const markFailed = vi.fn()
    const failure = new Error('catalog unavailable')
    const recovery = new AppTerminalProjectionRecovery({
      projection: {
        reconcileServerSessionsSnapshot: vi.fn(() => true),
        resynchronizeConnectedViews: vi.fn(),
        terminalSessionsCatalogCoverageRevision: vi.fn(() => null),
      },
      readClientId: () => 'client-test',
      recoverSessions: async () => await Promise.reject(failure),
      hydrationEntry: () => ({ workspaceRuntimeId: TARGET.workspaceRuntimeId, phase: 'pending' }),
      beginHydration: vi.fn(),
      markReady: vi.fn(),
      markFailed,
      isFocusRefreshDue: () => true,
      logFailure: vi.fn(),
    })

    recovery.request(new RuntimeProjectionScope(TARGET, () => true), { kind: 'minimum-revision', revision: 0 })

    await vi.waitFor(() =>
      expect(markFailed).toHaveBeenCalledWith(TARGET.workspaceId, TARGET.workspaceRuntimeId, failure.message),
    )
  })

  test('fails fast when the server snapshot does not reach the requested revision', async () => {
    const markFailed = vi.fn()
    const recoverSessions = vi.fn(async () => ({ revision: 2, sessions: [] }))
    const recovery = new AppTerminalProjectionRecovery({
      projection: {
        reconcileServerSessionsSnapshot: vi.fn(() => true),
        resynchronizeConnectedViews: vi.fn(),
        terminalSessionsCatalogCoverageRevision: vi.fn(() => null),
      },
      readClientId: () => 'client-test',
      recoverSessions,
      hydrationEntry: () => ({ workspaceRuntimeId: TARGET.workspaceRuntimeId, phase: 'pending' }),
      beginHydration: vi.fn(),
      markReady: vi.fn(),
      markFailed,
      isFocusRefreshDue: () => true,
      logFailure: vi.fn(),
    })

    recovery.request(new RuntimeProjectionScope(TARGET, () => true), { kind: 'minimum-revision', revision: 3 })

    await vi.waitFor(() => expect(markFailed).toHaveBeenCalledOnce())
    expect(recoverSessions).toHaveBeenCalledOnce()
  })

  test('resynchronizes connected views only after a fresh reconnect catalog is accepted', async () => {
    const resynchronizeConnectedViews = vi.fn()
    const recovery = new AppTerminalProjectionRecovery({
      projection: {
        reconcileServerSessionsSnapshot: vi.fn(() => true),
        resynchronizeConnectedViews,
        terminalSessionsCatalogCoverageRevision: vi.fn(() => 3),
      },
      readClientId: () => 'client-test',
      recoverSessions: async () => ({ revision: 3, sessions: [] }),
      hydrationEntry: () => ({ workspaceRuntimeId: TARGET.workspaceRuntimeId, phase: 'pending' }),
      beginHydration: vi.fn(),
      markReady: vi.fn(),
      markFailed: vi.fn(),
      isFocusRefreshDue: () => true,
      logFailure: vi.fn(),
    })

    recovery.request(new RuntimeProjectionScope(TARGET, () => true), { kind: 'reconnect' })

    await vi.waitFor(() =>
      expect(resynchronizeConnectedViews).toHaveBeenCalledWith(TARGET.workspaceId, TARGET.workspaceRuntimeId),
    )
  })

  test('keeps reconnect resynchronization pending after recovery fails', async () => {
    const recoverSessions = vi
      .fn(async (): Promise<TerminalSessionsSnapshot> => ({ revision: 2, sessions: [] }))
      .mockRejectedValueOnce(new Error('network unavailable'))
    const resynchronizeConnectedViews = vi.fn()
    const logFailure = vi.fn()
    const recovery = new AppTerminalProjectionRecovery({
      projection: {
        reconcileServerSessionsSnapshot: vi.fn(() => true),
        resynchronizeConnectedViews,
        terminalSessionsCatalogCoverageRevision: vi.fn(() => 2),
      },
      readClientId: () => 'client-test',
      recoverSessions,
      hydrationEntry: () => ({ workspaceRuntimeId: TARGET.workspaceRuntimeId, phase: 'ready' }),
      beginHydration: vi.fn(),
      markReady: vi.fn(),
      markFailed: vi.fn(),
      isFocusRefreshDue: () => true,
      logFailure,
    })
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    recovery.request(scope, { kind: 'reconnect' })
    await vi.waitFor(() => expect(logFailure).toHaveBeenCalledOnce())
    expect(resynchronizeConnectedViews).not.toHaveBeenCalled()

    recovery.request(scope, { kind: 'minimum-revision', revision: 2 })

    await vi.waitFor(() => expect(resynchronizeConnectedViews).toHaveBeenCalledOnce())
  })

  test('lets a newer refresh consume reconnect resynchronization before a stale reconnect response', async () => {
    const reconnect = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const refresh = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const recoverSessions = vi.fn().mockReturnValueOnce(reconnect.promise).mockReturnValueOnce(refresh.promise)
    const reconcileServerSessionsSnapshot = vi.fn(
      (_target: typeof TARGET, catalog: TerminalSessionsSnapshot) => catalog.revision === 2,
    )
    const resynchronizeConnectedViews = vi.fn()
    const recovery = new AppTerminalProjectionRecovery({
      projection: {
        reconcileServerSessionsSnapshot,
        resynchronizeConnectedViews,
        terminalSessionsCatalogCoverageRevision: vi.fn(() => 2),
      },
      readClientId: () => 'client-test',
      recoverSessions,
      hydrationEntry: () => ({ workspaceRuntimeId: TARGET.workspaceRuntimeId, phase: 'ready' }),
      beginHydration: vi.fn(),
      markReady: vi.fn(),
      markFailed: vi.fn(),
      isFocusRefreshDue: () => true,
      logFailure: vi.fn(),
    })
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    recovery.request(scope, { kind: 'reconnect' })
    recovery.request(scope, { kind: 'minimum-revision', revision: 2 })
    refresh.resolve({ revision: 2, sessions: [] })

    await vi.waitFor(() => expect(resynchronizeConnectedViews).toHaveBeenCalledOnce())

    reconnect.resolve({ revision: 1, sessions: [] })
    await vi.waitFor(() => expect(reconcileServerSessionsSnapshot).toHaveBeenCalledTimes(2))
    expect(resynchronizeConnectedViews).toHaveBeenCalledOnce()
  })

  test('does not let a refresh requested before reconnect consume its resynchronization', async () => {
    const refresh = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const reconnect = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const recoverSessions = vi.fn().mockReturnValueOnce(refresh.promise).mockReturnValueOnce(reconnect.promise)
    const resynchronizeConnectedViews = vi.fn()
    const recovery = new AppTerminalProjectionRecovery({
      projection: {
        reconcileServerSessionsSnapshot: vi.fn(() => true),
        resynchronizeConnectedViews,
        terminalSessionsCatalogCoverageRevision: vi.fn(() => 2),
      },
      readClientId: () => 'client-test',
      recoverSessions,
      hydrationEntry: () => ({ workspaceRuntimeId: TARGET.workspaceRuntimeId, phase: 'ready' }),
      beginHydration: vi.fn(),
      markReady: vi.fn(),
      markFailed: vi.fn(),
      isFocusRefreshDue: () => true,
      logFailure: vi.fn(),
    })
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    recovery.request(scope, { kind: 'minimum-revision', revision: 0 })
    recovery.request(scope, { kind: 'reconnect' })
    refresh.resolve({ revision: 2, sessions: [] })

    await vi.waitFor(() => expect(recoverSessions).toHaveBeenCalledTimes(2))
    expect(resynchronizeConnectedViews).not.toHaveBeenCalled()

    reconnect.resolve({ revision: 2, sessions: [] })
    await vi.waitFor(() => expect(resynchronizeConnectedViews).toHaveBeenCalledOnce())
  })

  test('keeps reconnect resynchronization pending when rebuilding a view fails', async () => {
    const viewFailure = new Error('view rebuild failed')
    const resynchronizeConnectedViews = vi.fn().mockImplementationOnce(() => {
      throw viewFailure
    })
    const logFailure = vi.fn()
    const recovery = new AppTerminalProjectionRecovery({
      projection: {
        reconcileServerSessionsSnapshot: vi.fn(() => true),
        resynchronizeConnectedViews,
        terminalSessionsCatalogCoverageRevision: vi.fn(() => 2),
      },
      readClientId: () => 'client-test',
      recoverSessions: async () => ({ revision: 2, sessions: [] }),
      hydrationEntry: () => ({ workspaceRuntimeId: TARGET.workspaceRuntimeId, phase: 'ready' }),
      beginHydration: vi.fn(),
      markReady: vi.fn(),
      markFailed: vi.fn(),
      isFocusRefreshDue: () => true,
      logFailure,
    })
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    recovery.request(scope, { kind: 'reconnect' })
    await vi.waitFor(() => expect(logFailure).toHaveBeenCalledWith(viewFailure))

    recovery.request(scope, { kind: 'minimum-revision', revision: 2 })

    await vi.waitFor(() => expect(resynchronizeConnectedViews).toHaveBeenCalledTimes(2))
  })

  test('lets only the latest reconnect recovery consume view resynchronization', async () => {
    const firstReconnect = Promise.withResolvers<TerminalSessionsSnapshot>()
    const secondReconnect = Promise.withResolvers<TerminalSessionsSnapshot>()
    const recoverSessions = vi
      .fn()
      .mockReturnValueOnce(firstReconnect.promise)
      .mockReturnValueOnce(secondReconnect.promise)
    const resynchronizeConnectedViews = vi.fn()
    const recovery = new AppTerminalProjectionRecovery({
      projection: {
        reconcileServerSessionsSnapshot: vi.fn(() => true),
        resynchronizeConnectedViews,
        terminalSessionsCatalogCoverageRevision: vi.fn(() => 2),
      },
      readClientId: () => 'client-test',
      recoverSessions,
      hydrationEntry: () => ({ workspaceRuntimeId: TARGET.workspaceRuntimeId, phase: 'ready' }),
      beginHydration: vi.fn(),
      markReady: vi.fn(),
      markFailed: vi.fn(),
      isFocusRefreshDue: () => true,
      logFailure: vi.fn(),
    })
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    recovery.request(scope, { kind: 'reconnect' })
    recovery.request(scope, { kind: 'reconnect' })
    firstReconnect.resolve({ revision: 1, sessions: [] })

    await vi.waitFor(() => expect(recoverSessions).toHaveBeenCalledTimes(2))
    expect(resynchronizeConnectedViews).not.toHaveBeenCalled()

    secondReconnect.resolve({ revision: 2, sessions: [] })
    await vi.waitFor(() => expect(resynchronizeConnectedViews).toHaveBeenCalledOnce())
  })
})
