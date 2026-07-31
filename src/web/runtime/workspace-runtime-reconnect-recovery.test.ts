import { describe, expect, test, vi } from 'vitest'
import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
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
      beginRecovery: vi.fn(() => {
        order.push('recovery-begin')
        return vi.fn()
      }),
      logFailure: vi.fn(),
    })

    recovery.request()

    await vi.waitFor(() => expect(workspaceTabsRecovery.request).toHaveBeenCalled())
    expect(order).toEqual(['recovery-begin', 'membership', 'terminal-begin', 'terminal-recover', 'tabs-recover'])
  })

  test('drops a membership result invalidated while it was in flight', async () => {
    const membership = Promise.withResolvers<{ kind: 'settled'; targets: [typeof TARGET] }>()
    const terminalRecovery = { begin: vi.fn(), request: vi.fn() }
    const workspaceTabsRecovery = { request: vi.fn() }
    const failRecovery = vi.fn()
    const beginRecovery = vi.fn(() => failRecovery)
    const recovery = new WorkspaceRuntimeReconnectRecovery({
      scopeRegistry: createRuntimeProjectionScopeRegistry(() => true),
      reconcileMemberships: async () => await membership.promise,
      currentWorkspaceRuntimeId: () => TARGET.workspaceRuntimeId,
      terminalRecovery,
      workspaceTabsRecovery,
      beginRecovery,
      logFailure: vi.fn(),
    })

    recovery.request()
    recovery.invalidate()
    membership.resolve({ kind: 'settled', targets: [TARGET] })
    await waitForNextMacrotask()

    expect(terminalRecovery.begin).not.toHaveBeenCalled()
    expect(workspaceTabsRecovery.request).not.toHaveBeenCalled()
    expect(beginRecovery).toHaveBeenCalledOnce()
    expect(failRecovery).not.toHaveBeenCalled()
  })

  test('fails the captured projection recovery when current membership recovery rejects', async () => {
    const failure = new Error('membership unavailable')
    const failRecovery = vi.fn()
    const logFailure = vi.fn()
    const recovery = new WorkspaceRuntimeReconnectRecovery({
      scopeRegistry: createRuntimeProjectionScopeRegistry(() => true),
      reconcileMemberships: async () => await Promise.reject(failure),
      currentWorkspaceRuntimeId: () => TARGET.workspaceRuntimeId,
      terminalRecovery: { begin: vi.fn(), request: vi.fn() },
      workspaceTabsRecovery: { request: vi.fn() },
      beginRecovery: vi.fn(() => failRecovery),
      logFailure,
    })

    recovery.request()

    await vi.waitFor(() => expect(failRecovery).toHaveBeenCalledWith(failure))
    expect(logFailure).toHaveBeenCalledWith(failure)
  })

  test('fails the captured projection recovery when current membership recovery has no successor', async () => {
    const failRecovery = vi.fn()
    const recovery = new WorkspaceRuntimeReconnectRecovery({
      scopeRegistry: createRuntimeProjectionScopeRegistry(() => true),
      reconcileMemberships: async () => ({ kind: 'superseded' }),
      currentWorkspaceRuntimeId: () => TARGET.workspaceRuntimeId,
      terminalRecovery: { begin: vi.fn(), request: vi.fn() },
      workspaceTabsRecovery: { request: vi.fn() },
      beginRecovery: vi.fn(() => failRecovery),
      logFailure: vi.fn(),
    })

    recovery.request()

    await vi.waitFor(() => expect(failRecovery).toHaveBeenCalledWith(expect.any(Error)))
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
      beginRecovery: vi.fn(() => vi.fn()),
      logFailure: vi.fn(),
    })

    recovery.request()
    await waitForNextMacrotask()

    expect(terminalRecovery.begin).not.toHaveBeenCalled()
    expect(workspaceTabsRecovery.request).not.toHaveBeenCalled()
  })
})
