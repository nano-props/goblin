import { describe, expect, test, vi } from 'vitest'
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
        terminalSessionsCatalogCoverageRevision: () => null,
        reconcileServerSessionsSnapshot: reconcile,
        resynchronizeConnectedViews: vi.fn(),
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
        terminalSessionsCatalogCoverageRevision: () => null,
        reconcileServerSessionsSnapshot: vi.fn(() => true),
        resynchronizeConnectedViews: vi.fn(),
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

  test('resynchronizes connected views only after a fresh reconnect catalog is accepted', async () => {
    const resynchronizeConnectedViews = vi.fn()
    const recovery = new AppTerminalProjectionRecovery({
      projection: {
        terminalSessionsCatalogCoverageRevision: () => 3,
        reconcileServerSessionsSnapshot: vi.fn(() => true),
        resynchronizeConnectedViews,
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
})
