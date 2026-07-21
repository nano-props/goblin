import { describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { createRuntimeProjectionScopeRegistry } from '#/web/runtime/runtime-projection-scope.ts'
import { WorkspaceRuntimeReconnectRecovery } from '#/web/runtime/workspace-runtime-reconnect-recovery.ts'

const TARGET = {
  workspaceId: workspaceIdForTest('goblin+file:///workspace'),
  workspaceRuntimeId: 'workspace-runtime-current',
}

describe('WorkspaceRuntimeReconnectRecovery', () => {
  test('recovers terminal and tabs only after canonical membership reconciliation', async () => {
    const order: string[] = []
    const scopeRegistry = createRuntimeProjectionScopeRegistry(() => true)
    const terminalRecovery = {
      begin: vi.fn(() => order.push('terminal-begin')),
      request: vi.fn(() => order.push('terminal-recover')),
    }
    const workspaceTabsRecovery = { request: vi.fn(() => order.push('tabs-recover')) }
    const recovery = new WorkspaceRuntimeReconnectRecovery({
      scopeRegistry,
      reconcileMemberships: async () => {
        order.push('membership')
        return { kind: 'settled', targets: [TARGET] }
      },
      currentWorkspaceRuntimeId: () => TARGET.workspaceRuntimeId,
      terminalRecovery,
      workspaceTabsRecovery,
      logFailure: vi.fn(),
    })

    recovery.request()

    await vi.waitFor(() => expect(workspaceTabsRecovery.request).toHaveBeenCalled())
    expect(order).toEqual(['membership', 'terminal-begin', 'terminal-recover', 'tabs-recover'])
  })

  test('drops a membership result invalidated while it was in flight', async () => {
    let resolveMembership!: (value: { kind: 'settled'; targets: [typeof TARGET] }) => void
    const membership = new Promise<{ kind: 'settled'; targets: [typeof TARGET] }>((resolve) => {
      resolveMembership = resolve
    })
    const terminalRecovery = { begin: vi.fn(), request: vi.fn() }
    const workspaceTabsRecovery = { request: vi.fn() }
    const recovery = new WorkspaceRuntimeReconnectRecovery({
      scopeRegistry: createRuntimeProjectionScopeRegistry(() => true),
      reconcileMemberships: async () => await membership,
      currentWorkspaceRuntimeId: () => TARGET.workspaceRuntimeId,
      terminalRecovery,
      workspaceTabsRecovery,
      logFailure: vi.fn(),
    })

    recovery.request()
    recovery.invalidate()
    resolveMembership({ kind: 'settled', targets: [TARGET] })
    await Promise.resolve()
    await Promise.resolve()

    expect(terminalRecovery.begin).not.toHaveBeenCalled()
    expect(workspaceTabsRecovery.request).not.toHaveBeenCalled()
  })

  test('does not recover a target replaced after membership reconciliation', async () => {
    const terminalRecovery = { begin: vi.fn(), request: vi.fn() }
    const workspaceTabsRecovery = { request: vi.fn() }
    const recovery = new WorkspaceRuntimeReconnectRecovery({
      scopeRegistry: createRuntimeProjectionScopeRegistry(() => true),
      reconcileMemberships: async () => ({ kind: 'settled', targets: [TARGET] }),
      currentWorkspaceRuntimeId: () => 'workspace-runtime-newer',
      terminalRecovery,
      workspaceTabsRecovery,
      logFailure: vi.fn(),
    })

    recovery.request()
    await Promise.resolve()
    await Promise.resolve()

    expect(terminalRecovery.begin).not.toHaveBeenCalled()
    expect(workspaceTabsRecovery.request).not.toHaveBeenCalled()
  })
})
