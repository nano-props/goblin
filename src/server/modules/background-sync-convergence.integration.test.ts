import { QueryClient, QueryObserver } from '@tanstack/query-core'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type * as InvalidationBroker from '#/server/modules/invalidation-broker.ts'
import { REPO_ID, mocks } from '#/server/test-utils/repo-module.ts'
import { testWorkspaceRuntimeEpochCapability } from '#/server/test-utils/workspace-runtime-capability.ts'
import { commandOutcomeForTest } from '#/test-utils/command-outcome.ts'
import { useFakeTimers } from '#/test-utils/timers.ts'

const USER_ID = 'background-convergence-user'
const CLIENT_ID = 'background-convergence-client'
const RUNTIME_ID = 'background-convergence-runtime'

describe('background sync projection convergence', () => {
  afterEach(async () => {
    const { resetBackgroundSyncForTests } = await import('#/server/modules/background-sync.ts')
    resetBackgroundSyncForTests()
  })

  test('registered background fetch invalidates a mounted observer into the final projection', async () => {
    useFakeTimers()
    const broker = await vi.importActual<typeof InvalidationBroker>('#/server/modules/invalidation-broker.ts')
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const projectionQueryKey = ['repo-data', REPO_ID, RUNTIME_ID, 'projection'] as const
    let projection = 'before-fetch'
    let projectionReads = 0
    const observer = new QueryObserver(queryClient, {
      queryKey: projectionQueryKey,
      queryFn: async () => {
        projectionReads += 1
        return projection
      },
      staleTime: Number.POSITIVE_INFINITY,
    })
    const unsubscribe = observer.subscribe(() => {})
    const socket = {
      send(payload: string) {
        const event = JSON.parse(payload) as { type?: string; repoId?: string; domain?: string }
        if (event.type === 'repo-read-invalidated' && event.repoId === REPO_ID && event.domain === 'metadata') {
          void queryClient.invalidateQueries({ queryKey: projectionQueryKey, exact: true, refetchType: 'active' })
        }
      },
      close: vi.fn(),
    }
    broker.registerInvalidationSocket(socket)
    mocks.publishRepoReadInvalidation.mockImplementation((event) => broker.publishRepoReadInvalidation(event))
    mocks.fetchAll.mockImplementation(async () => {
      projection = 'after-fetch'
      return commandOutcomeForTest({ ok: true, message: 'fetched' })
    })

    try {
      await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('before-fetch'))
      const { beginBackgroundSyncRegistration, commitBackgroundSyncRegistration, prepareBackgroundSync } =
        await import('#/server/modules/background-sync.ts')
      await prepareBackgroundSync()
      const admission = beginBackgroundSyncRegistration(USER_ID, CLIENT_ID, 1, [
        {
          workspaceId: REPO_ID,
          workspaceRuntimeId: RUNTIME_ID,
          runtimeCapability: testWorkspaceRuntimeEpochCapability({
            userId: USER_ID,
            workspaceId: REPO_ID,
            workspaceRuntimeId: RUNTIME_ID,
          }),
        },
      ])
      if (!admission) throw new Error('expected background sync admission')
      expect(commitBackgroundSyncRegistration(admission)).toBe(true)
      await vi.runOnlyPendingTimersAsync()

      await vi.waitFor(() => {
        expect(mocks.fetchAll).toHaveBeenCalledTimes(1)
        expect(projectionReads).toBe(2)
        expect(observer.getCurrentResult().data).toBe('after-fetch')
      })
    } finally {
      broker.unregisterInvalidationSocket(socket)
      unsubscribe()
      queryClient.clear()
    }
  })
})
