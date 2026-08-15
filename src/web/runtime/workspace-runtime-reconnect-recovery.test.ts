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
  test('recovers projections only after canonical membership reconciliation', async () => {
    const order: string[] = []
    const terminalRecovery = { begin: vi.fn(() => order.push('terminal')), request: vi.fn() }
    const workspaceTabsRecovery = { request: vi.fn(() => order.push('tabs')) }
    const resyncRepoReads = vi.fn(async () => {
      order.push('repo')
    })
    const recovery = new WorkspaceRuntimeReconnectRecovery({
      scopeRegistry: createRuntimeProjectionScopeRegistry(() => true),
      reconcileMemberships: async () => {
        order.push('membership')
        return { kind: 'settled', targets: [TARGET] }
      },
      currentWorkspaceRuntimeId: () => TARGET.workspaceRuntimeId,
      terminalRecovery,
      workspaceTabsRecovery,
      resyncRepoReads,
      logFailure: vi.fn(),
    })

    recovery.request()

    await vi.waitFor(() => expect(resyncRepoReads).toHaveBeenCalledOnce())
    expect(order).toEqual(['membership', 'terminal', 'tabs', 'repo'])
    expect(terminalRecovery.begin).toHaveBeenCalledWith(expect.anything(), { kind: 'reconnect' })
    expect(workspaceTabsRecovery.request).toHaveBeenCalledWith(expect.anything(), { kind: 'fresh' })
  })

  test('drops a membership result invalidated while it was in flight', async () => {
    const membership = Promise.withResolvers<{ kind: 'settled'; targets: [typeof TARGET] }>()
    const terminalRecovery = { begin: vi.fn(), request: vi.fn() }
    const workspaceTabsRecovery = { request: vi.fn() }
    const resyncRepoReads = vi.fn(async () => {})
    const recovery = new WorkspaceRuntimeReconnectRecovery({
      scopeRegistry: createRuntimeProjectionScopeRegistry(() => true),
      reconcileMemberships: async () => await membership.promise,
      currentWorkspaceRuntimeId: () => TARGET.workspaceRuntimeId,
      terminalRecovery,
      workspaceTabsRecovery,
      resyncRepoReads,
      logFailure: vi.fn(),
    })

    recovery.request()
    recovery.invalidate()
    membership.resolve({ kind: 'settled', targets: [TARGET] })
    await waitForNextMacrotask()

    expect(terminalRecovery.begin).not.toHaveBeenCalled()
    expect(workspaceTabsRecovery.request).not.toHaveBeenCalled()
    expect(resyncRepoReads).not.toHaveBeenCalled()
  })

  test('resyncs repo reads without publishing a replaced runtime target', async () => {
    const terminalRecovery = { begin: vi.fn(), request: vi.fn() }
    const workspaceTabsRecovery = { request: vi.fn() }
    const resyncRepoReads = vi.fn(async () => {})
    const recovery = new WorkspaceRuntimeReconnectRecovery({
      scopeRegistry: createRuntimeProjectionScopeRegistry(() => true),
      reconcileMemberships: async () => ({ kind: 'settled', targets: [TARGET] }),
      currentWorkspaceRuntimeId: () => 'workspace-runtime-newer',
      terminalRecovery,
      workspaceTabsRecovery,
      resyncRepoReads,
      logFailure: vi.fn(),
    })

    recovery.request()
    await vi.waitFor(() => expect(resyncRepoReads).toHaveBeenCalledOnce())

    expect(terminalRecovery.begin).not.toHaveBeenCalled()
    expect(workspaceTabsRecovery.request).not.toHaveBeenCalled()
  })

  test('lets only the latest reconnect publish recovered projections', async () => {
    const firstMembership = Promise.withResolvers<{ kind: 'settled'; targets: [typeof TARGET] }>()
    const secondMembership = Promise.withResolvers<{ kind: 'settled'; targets: [typeof TARGET] }>()
    const reconcileMemberships = vi
      .fn<() => Promise<{ kind: 'settled'; targets: [typeof TARGET] }>>()
      .mockReturnValueOnce(firstMembership.promise)
      .mockReturnValueOnce(secondMembership.promise)
    const terminalRecovery = { begin: vi.fn(), request: vi.fn() }
    const resyncRepoReads = vi.fn(async () => {})
    const recovery = new WorkspaceRuntimeReconnectRecovery({
      scopeRegistry: createRuntimeProjectionScopeRegistry(() => true),
      reconcileMemberships,
      currentWorkspaceRuntimeId: () => TARGET.workspaceRuntimeId,
      terminalRecovery,
      workspaceTabsRecovery: { request: vi.fn() },
      resyncRepoReads,
      logFailure: vi.fn(),
    })

    recovery.request()
    recovery.request()
    firstMembership.resolve({ kind: 'settled', targets: [TARGET] })
    await waitForNextMacrotask()
    expect(terminalRecovery.begin).not.toHaveBeenCalled()
    expect(resyncRepoReads).not.toHaveBeenCalled()

    secondMembership.resolve({ kind: 'settled', targets: [TARGET] })
    await vi.waitFor(() => expect(resyncRepoReads).toHaveBeenCalledOnce())
    expect(terminalRecovery.begin).toHaveBeenCalledOnce()
  })

  test('stops projection recovery when membership reconciliation fails', async () => {
    const failure = new Error('membership recovery failed')
    const logFailure = vi.fn()
    const terminalRecovery = { begin: vi.fn(), request: vi.fn() }
    const resyncRepoReads = vi.fn(async () => {})
    const recovery = new WorkspaceRuntimeReconnectRecovery({
      scopeRegistry: createRuntimeProjectionScopeRegistry(() => true),
      reconcileMemberships: async () => {
        throw failure
      },
      currentWorkspaceRuntimeId: () => TARGET.workspaceRuntimeId,
      terminalRecovery,
      workspaceTabsRecovery: { request: vi.fn() },
      resyncRepoReads,
      logFailure,
    })

    recovery.request()
    await vi.waitFor(() => expect(logFailure).toHaveBeenCalledWith(failure))
    expect(terminalRecovery.begin).not.toHaveBeenCalled()
    expect(resyncRepoReads).not.toHaveBeenCalled()
  })
})
