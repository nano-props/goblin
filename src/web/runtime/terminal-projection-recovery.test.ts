import { describe, expect, test, vi } from 'vitest'
import { RuntimeProjectionScope } from '#/web/runtime/runtime-projection-scope.ts'
import { TerminalProjectionRecoveryCoordinator } from '#/web/runtime/terminal-projection-recovery.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

const WORKSPACE_ID = canonicalWorkspaceLocator('goblin+file:///workspace')
if (!WORKSPACE_ID) throw new Error('invalid workspace locator fixture')
const TARGET = { workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'repo-runtime-test' }
const complete = () => {}

describe('TerminalProjectionRecoveryCoordinator', () => {
  test('coalesces a newer minimum revision into one in-flight snapshot when it already satisfies it', async () => {
    const deferred = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const recover = vi.fn(async () => await deferred.promise)
    const accept = vi.fn(() => ({ kind: 'accepted' as const }))
    const coordinator = new TerminalProjectionRecoveryCoordinator()
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    coordinator.request({
      scope,
      complete,
      minimumRevision: 0,
      freshness: 'join-current',
      recover,
      accept,
      reject: vi.fn(),
    })
    coordinator.request({
      scope,
      complete,
      minimumRevision: 4,
      freshness: 'join-current',
      recover,
      accept,
      reject: vi.fn(),
    })
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

    coordinator.request({
      scope,
      complete,
      minimumRevision: 3,
      freshness: 'join-current',
      recover,
      accept,
      reject: vi.fn(),
    })

    await vi.waitFor(() => expect(accept).toHaveBeenCalledWith({ revision: 3, sessions: [] }))
    expect(recover).toHaveBeenCalledTimes(2)
  })

  test('rejects when one follow-up still cannot reach the required revision', async () => {
    const recover = vi.fn(async () => ({ revision: 1, sessions: [] as [] }))
    const accept = vi.fn(() => ({ kind: 'accepted' as const }))
    const reject = vi.fn()
    const coordinator = new TerminalProjectionRecoveryCoordinator()
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    coordinator.request({ scope, complete, minimumRevision: 3, freshness: 'join-current', recover, accept, reject })

    await vi.waitFor(() => expect(recover).toHaveBeenCalledTimes(2))
    expect(accept).not.toHaveBeenCalled()
    expect(reject).toHaveBeenCalledOnce()
    expect(reject).toHaveBeenCalledWith(
      new Error('Terminal sessions recovery did not reach required revision 3; received 1'),
    )
  })

  test('gives a newer minimum revision its own follow-up read', async () => {
    const firstRead = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const secondRead = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const thirdRead = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const recover = vi
      .fn<() => Promise<{ revision: number; sessions: [] }>>()
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(secondRead.promise)
      .mockReturnValueOnce(thirdRead.promise)
    const accept = vi.fn(() => ({ kind: 'accepted' as const }))
    const reject = vi.fn()
    const coordinator = new TerminalProjectionRecoveryCoordinator()
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    coordinator.request({
      scope,
      complete,
      minimumRevision: 3,
      freshness: 'join-current',
      recover,
      accept,
      reject,
    })
    firstRead.resolve({ revision: 2, sessions: [] })
    await vi.waitFor(() => expect(recover).toHaveBeenCalledTimes(2))

    coordinator.request({
      scope,
      complete,
      minimumRevision: 4,
      freshness: 'join-current',
      recover,
      accept,
      reject,
    })
    secondRead.resolve({ revision: 3, sessions: [] })
    await vi.waitFor(() => expect(recover).toHaveBeenCalledTimes(3))
    thirdRead.resolve({ revision: 4, sessions: [] })

    await vi.waitFor(() => expect(accept).toHaveBeenCalledWith({ revision: 4, sessions: [] }))
    expect(reject).not.toHaveBeenCalled()
  })

  test('gives a newer minimum revision its first read when the older in-flight read fails', async () => {
    const firstRead = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const recoverInitial = vi.fn(async () => await firstRead.promise)
    const recoverNewerRevision = vi.fn(async () => ({ revision: 4, sessions: [] as [] }))
    const accept = vi.fn(() => ({ kind: 'accepted' as const }))
    const reject = vi.fn()
    const coordinator = new TerminalProjectionRecoveryCoordinator()
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    coordinator.request({
      scope,
      complete,
      minimumRevision: 0,
      freshness: 'join-current',
      recover: recoverInitial,
      accept,
      reject,
    })
    coordinator.request({
      scope,
      complete,
      minimumRevision: 4,
      freshness: 'join-current',
      recover: recoverNewerRevision,
      accept,
      reject,
    })
    firstRead.reject(new Error('initial recovery failed'))

    await vi.waitFor(() => expect(accept).toHaveBeenCalledWith({ revision: 4, sessions: [] }))
    expect(recoverInitial).toHaveBeenCalledOnce()
    expect(recoverNewerRevision).toHaveBeenCalledOnce()
    expect(reject).not.toHaveBeenCalled()
  })

  test('fails fast when an in-flight read fails without a newer minimum revision', async () => {
    const failure = new Error('recovery failed')
    const recover = vi.fn(async () => await Promise.reject(failure))
    const accept = vi.fn(() => ({ kind: 'accepted' as const }))
    const reject = vi.fn()
    const coordinator = new TerminalProjectionRecoveryCoordinator()
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    coordinator.request({
      scope,
      complete,
      minimumRevision: 4,
      freshness: 'join-current',
      recover,
      accept,
      reject,
    })

    await vi.waitFor(() => expect(reject).toHaveBeenCalledWith(failure))
    expect(recover).toHaveBeenCalledOnce()
    expect(accept).not.toHaveBeenCalled()
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
      freshness: 'join-current',
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
      freshness: 'join-current',
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
      freshness: 'after-current',
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
      freshness: 'join-current',
      recover: recoverCold,
      accept,
      reject: vi.fn(),
    })
    coordinator.request({
      scope,
      complete,
      minimumRevision: 0,
      freshness: 'after-current',
      recover: recoverAfterReconnect,
      accept,
      afterAccept: resynchronize,
      reject: vi.fn(),
    })
    coldRecovery.resolve({ revision: 4, sessions: [] })

    await vi.waitFor(() => expect(resynchronize).toHaveBeenCalledOnce())
    expect(recoverCold).toHaveBeenCalledOnce()
    expect(recoverAfterReconnect).toHaveBeenCalledOnce()
    expect(accept).toHaveBeenCalledOnce()
    expect(accept).toHaveBeenCalledWith({ revision: 5, sessions: [] })
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
      freshness: 'join-current',
      recover: recoverCold,
      accept,
      reject: vi.fn(),
    })
    coordinator.request({
      scope,
      complete,
      minimumRevision: 0,
      freshness: 'after-current',
      recover: recoverAfterReconnect,
      accept,
      afterAccept: resynchronize,
      reject: vi.fn(),
    })
    coordinator.request({
      scope,
      complete,
      minimumRevision: 6,
      freshness: 'join-current',
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

  test('waits for a read started after the latest reconnect', async () => {
    const coldRecovery = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const firstReconnectRecovery = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const recoverCold = vi.fn(async () => await coldRecovery.promise)
    const recoverAfterFirstReconnect = vi.fn(async () => await firstReconnectRecovery.promise)
    const recoverAfterSecondReconnect = vi.fn(async () => ({ revision: 3, sessions: [] as [] }))
    const accept = vi.fn(() => ({ kind: 'accepted' as const }))
    const resynchronize = vi.fn()
    const coordinator = new TerminalProjectionRecoveryCoordinator()
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    coordinator.request({
      scope,
      complete,
      minimumRevision: 0,
      freshness: 'join-current',
      recover: recoverCold,
      accept,
      reject: vi.fn(),
    })
    coordinator.request({
      scope,
      complete,
      minimumRevision: 0,
      freshness: 'after-current',
      recover: recoverAfterFirstReconnect,
      accept,
      afterAccept: resynchronize,
      reject: vi.fn(),
    })
    coldRecovery.resolve({ revision: 1, sessions: [] })
    await vi.waitFor(() => expect(recoverAfterFirstReconnect).toHaveBeenCalledOnce())

    coordinator.request({
      scope,
      complete,
      minimumRevision: 0,
      freshness: 'after-current',
      recover: recoverAfterSecondReconnect,
      accept,
      afterAccept: resynchronize,
      reject: vi.fn(),
    })
    firstReconnectRecovery.resolve({ revision: 2, sessions: [] })

    await vi.waitFor(() => expect(resynchronize).toHaveBeenCalledOnce())
    expect(recoverAfterSecondReconnect).toHaveBeenCalledOnce()
    expect(accept).toHaveBeenCalledOnce()
    expect(accept).toHaveBeenCalledWith({ revision: 3, sessions: [] })
  })

  test('resets superseded retry state when an old read fails across reconnect', async () => {
    const firstRead = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const oldConnectionRead = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const freshRead = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const finalRead = Promise.withResolvers<{ revision: number; sessions: [] }>()
    const recover = vi
      .fn<() => Promise<{ revision: number; sessions: [] }>>()
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(oldConnectionRead.promise)
      .mockReturnValueOnce(freshRead.promise)
      .mockReturnValueOnce(finalRead.promise)
    const accept = vi
      .fn()
      .mockReturnValueOnce({ kind: 'superseded' as const, localRevision: 2 })
      .mockReturnValueOnce({ kind: 'superseded' as const, localRevision: 3 })
      .mockReturnValueOnce({ kind: 'accepted' as const })
    const reject = vi.fn()
    const resynchronize = vi.fn()
    const coordinator = new TerminalProjectionRecoveryCoordinator()
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    coordinator.request({
      scope,
      complete,
      minimumRevision: 0,
      freshness: 'join-current',
      recover,
      accept,
      reject,
    })
    firstRead.resolve({ revision: 1, sessions: [] })
    await vi.waitFor(() => expect(recover).toHaveBeenCalledTimes(2))

    coordinator.request({
      scope,
      complete,
      minimumRevision: 0,
      freshness: 'after-current',
      recover,
      accept,
      afterAccept: resynchronize,
      reject,
    })
    oldConnectionRead.reject(new Error('disconnected'))
    await vi.waitFor(() => expect(recover).toHaveBeenCalledTimes(3))
    freshRead.resolve({ revision: 2, sessions: [] })
    await vi.waitFor(() => expect(recover).toHaveBeenCalledTimes(4))
    finalRead.resolve({ revision: 3, sessions: [] })

    await vi.waitFor(() => expect(resynchronize).toHaveBeenCalledOnce())
    expect(accept).toHaveBeenCalledTimes(3)
    expect(reject).not.toHaveBeenCalled()
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
      freshness: 'join-current',
      recover: recoverCold,
      accept,
      reject,
    })
    coordinator.request({
      scope,
      complete: completeRecovery,
      minimumRevision: 0,
      freshness: 'after-current',
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
      freshness: 'join-current',
      recover: recoverNextTrigger,
      accept,
      reject,
    })

    await vi.waitFor(() => expect(resynchronize).toHaveBeenCalledOnce())
    expect(recoverNextTrigger).toHaveBeenCalledOnce()
    expect(completeRecovery).toHaveBeenCalledOnce()
    expect(reject).toHaveBeenCalledOnce()
  })

  test('does not complete recovery until reconnect view resynchronization succeeds', async () => {
    const failure = new Error('view rebuild failed')
    const resynchronize = vi.fn().mockImplementationOnce(() => {
      throw failure
    })
    const completeRecovery = vi.fn()
    const reject = vi.fn()
    const coordinator = new TerminalProjectionRecoveryCoordinator()
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    coordinator.request({
      scope,
      complete: completeRecovery,
      minimumRevision: 0,
      freshness: 'after-current',
      recover: async () => ({ revision: 1, sessions: [] }),
      accept: () => ({ kind: 'accepted' }),
      afterAccept: resynchronize,
      reject,
    })

    await vi.waitFor(() => expect(reject).toHaveBeenCalledWith(failure))
    expect(completeRecovery).not.toHaveBeenCalled()

    coordinator.request({
      scope,
      complete: completeRecovery,
      minimumRevision: 1,
      freshness: 'join-current',
      recover: async () => ({ revision: 1, sessions: [] }),
      accept: () => ({ kind: 'accepted' }),
      reject,
    })

    await vi.waitFor(() => expect(completeRecovery).toHaveBeenCalledOnce())
    expect(resynchronize).toHaveBeenCalledTimes(2)
  })
})
