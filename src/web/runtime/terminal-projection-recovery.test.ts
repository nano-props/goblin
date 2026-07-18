import { describe, expect, test, vi } from 'vitest'
import { RuntimeProjectionScope } from '#/web/runtime/runtime-projection-scope.ts'
import { TerminalProjectionRecoveryCoordinator } from '#/web/runtime/terminal-projection-recovery.ts'

const TARGET = { repoRoot: 'goblin+file:///workspace', workspaceRuntimeId: 'repo-runtime-test' }
const complete = () => {}

describe('TerminalProjectionRecoveryCoordinator', () => {
  test('coalesces a newer minimum revision into one in-flight snapshot when it already satisfies it', async () => {
    const deferred = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const recover = vi.fn(async () => await deferred.promise)
    const accept = vi.fn(() => ({ kind: 'accepted' as const }))
    const coordinator = new TerminalProjectionRecoveryCoordinator()
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    coordinator.request({ scope, complete, minimumRevision: 0, recover, accept, reject: vi.fn() })
    coordinator.request({ scope, complete, minimumRevision: 4, recover, accept, reject: vi.fn() })
    deferred.resolve({ revision: 4, sessions: [] })

    await vi.waitFor(() => expect(accept).toHaveBeenCalledOnce())
    expect(recover).toHaveBeenCalledOnce()
  })

  test('performs one follow-up when the in-flight snapshot is older than the desired revision', async () => {
    const recover = vi
      .fn<() => Promise<{ revision: number; sessions: [] }>>()
      .mockResolvedValueOnce({ revision: 2, sessions: [] })
      .mockResolvedValueOnce({ revision: 3, sessions: [] })
    const accept = vi.fn(() => ({ kind: 'accepted' as const }))
    const coordinator = new TerminalProjectionRecoveryCoordinator()
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    coordinator.request({ scope, complete, minimumRevision: 3, recover, accept, reject: vi.fn() })

    await vi.waitFor(() => expect(accept).toHaveBeenCalledWith({ revision: 3, sessions: [] }))
    expect(recover).toHaveBeenCalledTimes(2)
  })

  test('rejects when one follow-up still cannot reach the required revision', async () => {
    const recover = vi.fn(async () => ({ revision: 1, sessions: [] as [] }))
    const accept = vi.fn(() => ({ kind: 'accepted' as const }))
    const reject = vi.fn()
    const coordinator = new TerminalProjectionRecoveryCoordinator()
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    coordinator.request({ scope, complete, minimumRevision: 3, recover, accept, reject })

    await vi.waitFor(() => expect(recover).toHaveBeenCalledTimes(2))
    expect(accept).not.toHaveBeenCalled()
    expect(reject).toHaveBeenCalledOnce()
    expect(reject).toHaveBeenCalledWith(
      new Error('Terminal sessions recovery did not reach required revision 3; received 1'),
    )
  })

  test('rejects an active membership refusal without consuming resynchronization', async () => {
    const reject = vi.fn()
    const resynchronize = vi.fn()
    const coordinator = new TerminalProjectionRecoveryCoordinator()
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    coordinator.request({
      scope,
      complete,
      minimumRevision: 0,
      recover: async () => ({ revision: 1, sessions: [] }),
      accept: () => ({ kind: 'membership-rejected' }),
      afterAccept: resynchronize,
      reject,
    })

    await vi.waitFor(() => expect(reject).toHaveBeenCalledOnce())
    expect(reject).toHaveBeenCalledWith(
      new Error('Terminal sessions snapshot rejected by the active runtime membership'),
    )
    expect(resynchronize).not.toHaveBeenCalled()
  })

  test('ends quietly when membership becomes inactive while accepting a snapshot', async () => {
    let active = true
    const reject = vi.fn()
    const resynchronize = vi.fn()
    const coordinator = new TerminalProjectionRecoveryCoordinator()
    const scope = new RuntimeProjectionScope(TARGET, () => active)

    coordinator.request({
      scope,
      complete,
      minimumRevision: 0,
      recover: async () => ({ revision: 1, sessions: [] }),
      accept: () => {
        active = false
        return { kind: 'inactive' }
      },
      afterAccept: resynchronize,
      reject,
    })

    await vi.waitFor(() => expect(active).toBe(false))
    expect(reject).not.toHaveBeenCalled()
    expect(resynchronize).not.toHaveBeenCalled()
  })

  test('follows a locally superseded snapshot before consuming reconnect resynchronization', async () => {
    const recover = vi
      .fn<() => Promise<{ revision: number; sessions: [] }>>()
      .mockResolvedValueOnce({ revision: 1, sessions: [] })
      .mockResolvedValueOnce({ revision: 2, sessions: [] })
    const accept = vi
      .fn()
      .mockReturnValueOnce({ kind: 'superseded', localRevision: 2 })
      .mockReturnValueOnce({ kind: 'accepted' })
    const reject = vi.fn()
    const resynchronize = vi.fn()
    const coordinator = new TerminalProjectionRecoveryCoordinator()
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    coordinator.request({
      scope,
      complete,
      minimumRevision: 0,
      refresh: true,
      recover,
      accept,
      afterAccept: resynchronize,
      reject,
    })

    await vi.waitFor(() => expect(resynchronize).toHaveBeenCalledOnce())
    expect(recover).toHaveBeenCalledTimes(2)
    expect(accept).toHaveBeenCalledTimes(2)
    expect(reject).not.toHaveBeenCalled()
  })

  test('consumes reconnect resynchronization only after its one fresh follow-up', async () => {
    const coldRecovery = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const recoverCold = vi.fn(async () => await coldRecovery.promise)
    const recoverAfterReconnect = vi.fn(async () => ({ revision: 5, sessions: [] as [] }))
    const accept = vi.fn(() => ({ kind: 'accepted' as const }))
    const resynchronize = vi.fn()
    const coordinator = new TerminalProjectionRecoveryCoordinator()
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    coordinator.request({
      scope,
      complete,
      minimumRevision: 0,
      refresh: true,
      recover: recoverCold,
      accept,
      reject: vi.fn(),
    })
    coordinator.request({
      scope,
      complete,
      minimumRevision: 0,
      refresh: true,
      recover: recoverAfterReconnect,
      accept,
      afterAccept: resynchronize,
      reject: vi.fn(),
    })
    coldRecovery.resolve({ revision: 4, sessions: [] })

    await vi.waitFor(() => expect(resynchronize).toHaveBeenCalledOnce())
    expect(recoverCold).toHaveBeenCalledOnce()
    expect(recoverAfterReconnect).toHaveBeenCalledOnce()
    expect(accept).toHaveBeenCalledTimes(2)
    expect(accept).toHaveBeenLastCalledWith({ revision: 5, sessions: [] })
  })

  test('preserves reconnect resynchronization through a newer sessions event', async () => {
    const coldRecovery = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const recoverCold = vi.fn(async () => await coldRecovery.promise)
    const recoverAfterReconnect = vi.fn(async () => ({ revision: 5, sessions: [] as [] }))
    const recoverAfterSessionsEvent = vi.fn(async () => ({ revision: 6, sessions: [] as [] }))
    const accept = vi.fn(() => ({ kind: 'accepted' as const }))
    const resynchronize = vi.fn()
    const coordinator = new TerminalProjectionRecoveryCoordinator()
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    coordinator.request({
      scope,
      complete,
      minimumRevision: 0,
      refresh: true,
      recover: recoverCold,
      accept,
      reject: vi.fn(),
    })
    coordinator.request({
      scope,
      complete,
      minimumRevision: 0,
      refresh: true,
      recover: recoverAfterReconnect,
      accept,
      afterAccept: resynchronize,
      reject: vi.fn(),
    })
    coordinator.request({
      scope,
      complete,
      minimumRevision: 6,
      recover: recoverAfterSessionsEvent,
      accept,
      reject: vi.fn(),
    })
    coldRecovery.resolve({ revision: 5, sessions: [] })

    await vi.waitFor(() => expect(resynchronize).toHaveBeenCalledOnce())
    expect(recoverCold).toHaveBeenCalledOnce()
    expect(recoverAfterReconnect).not.toHaveBeenCalled()
    expect(recoverAfterSessionsEvent).toHaveBeenCalledOnce()
    expect(accept).toHaveBeenCalledOnce()
    expect(accept).toHaveBeenCalledWith({ revision: 6, sessions: [] })
  })

  test('keeps a failed reconnect follow-up dormant until the next accepted trigger', async () => {
    const coldRecovery = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const recoverCold = vi.fn(async () => await coldRecovery.promise)
    const recoverFailedFresh = vi.fn(async () => await Promise.reject(new Error('network unavailable')))
    const recoverNextTrigger = vi.fn(async () => ({ revision: 2, sessions: [] as [] }))
    const accept = vi.fn(() => ({ kind: 'accepted' as const }))
    const reject = vi.fn()
    const resynchronize = vi.fn()
    const completeRecovery = vi.fn()
    const coordinator = new TerminalProjectionRecoveryCoordinator()
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    coordinator.request({
      scope,
      complete: completeRecovery,
      minimumRevision: 0,
      refresh: true,
      recover: recoverCold,
      accept,
      reject,
    })
    coordinator.request({
      scope,
      complete: completeRecovery,
      minimumRevision: 0,
      refresh: true,
      recover: recoverFailedFresh,
      accept,
      afterAccept: resynchronize,
      reject,
    })
    coldRecovery.resolve({ revision: 1, sessions: [] })

    await vi.waitFor(() => expect(reject).toHaveBeenCalledOnce())
    expect(completeRecovery).not.toHaveBeenCalled()
    expect(resynchronize).not.toHaveBeenCalled()
    expect(recoverFailedFresh).toHaveBeenCalledOnce()

    coordinator.request({
      scope,
      complete: completeRecovery,
      minimumRevision: 2,
      recover: recoverNextTrigger,
      accept,
      reject,
    })

    await vi.waitFor(() => expect(resynchronize).toHaveBeenCalledOnce())
    expect(recoverNextTrigger).toHaveBeenCalledOnce()
    expect(completeRecovery).toHaveBeenCalledOnce()
    expect(reject).toHaveBeenCalledOnce()
  })
})
