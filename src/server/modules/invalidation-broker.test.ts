import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  disconnectAllInvalidationSockets,
  publishRepoQueryInvalidation,
  registerInvalidationSocket,
} from '#/server/modules/invalidation-broker.ts'

describe('invalidation broker', () => {
  beforeEach(() => {
    disconnectAllInvalidationSockets()
  })

  test('disconnects every registered invalidation socket during shutdown', () => {
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }
    registerInvalidationSocket(first)
    registerInvalidationSocket(second)

    disconnectAllInvalidationSockets()
    publishRepoQueryInvalidation({ repoId: 'repo_1', query: 'repo-snapshot' })

    expect(first.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(second.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(first.send).not.toHaveBeenCalled()
    expect(second.send).not.toHaveBeenCalled()
  })
})
