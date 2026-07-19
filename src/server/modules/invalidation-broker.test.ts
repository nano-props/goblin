import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  disconnectAllInvalidationSockets,
  InvalidationSocketLimitError,
  MAX_INVALIDATION_SOCKETS,
  publishRepoQueryInvalidation,
  publishUserWorkspaceFilesystemInvalidation,
  publishUserRepoQueryInvalidation,
  publishUserWorkspaceRuntimeInvalidation,
  registerInvalidationSocket,
  unregisterInvalidationSocket,
} from '#/server/modules/invalidation-broker.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

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

  test('rejects the (N+1)th subscriber to prevent socket floods', () => {
    for (let i = 0; i < MAX_INVALIDATION_SOCKETS; i += 1) {
      registerInvalidationSocket({ send: vi.fn(), close: vi.fn() })
    }
    const overflow = { send: vi.fn(), close: vi.fn() }
    expect(() => registerInvalidationSocket(overflow)).toThrow(InvalidationSocketLimitError)
  })

  test('frees a slot when a subscriber disconnects', () => {
    const sockets = Array.from({ length: MAX_INVALIDATION_SOCKETS }, () => ({ send: vi.fn(), close: vi.fn() }))
    for (const s of sockets) registerInvalidationSocket(s)
    unregisterInvalidationSocket(sockets[0]!)
    // The freed slot is available again.
    expect(() => registerInvalidationSocket({ send: vi.fn(), close: vi.fn() })).not.toThrow()
  })

  test('fans user-scoped invalidations only to sockets for that identity', () => {
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }
    registerInvalidationSocket(first, 'user_a')
    registerInvalidationSocket(second, 'user_b')

    publishUserRepoQueryInvalidation('user_a', { repoId: 'repo_1', query: 'repo-runtime' })

    expect(first.send).toHaveBeenCalledOnce()
    expect(second.send).not.toHaveBeenCalled()
  })

  test('publishes workspace runtime invalidations with canonical workspace identity', () => {
    const socket = { send: vi.fn(), close: vi.fn() }
    registerInvalidationSocket(socket, 'user_a')
    const workspaceId = workspaceIdForTest('goblin+ssh://example/workspace')

    publishUserWorkspaceRuntimeInvalidation('user_a', { workspaceId })

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'workspace-runtime-invalidated', workspaceId }))
  })

  test('publishes filesystem invalidations only to the owning user', () => {
    const owner = { send: vi.fn(), close: vi.fn() }
    const other = { send: vi.fn(), close: vi.fn() }
    registerInvalidationSocket(owner, 'user_a')
    registerInvalidationSocket(other, 'user_b')
    const workspaceId = workspaceIdForTest('goblin+file:///workspace')
    const target = { kind: 'workspace-root' as const, workspaceId, workspaceRuntimeId: 'workspace-runtime-test' }

    publishUserWorkspaceFilesystemInvalidation('user_a', { target })

    expect(owner.send).toHaveBeenCalledWith(JSON.stringify({ type: 'workspace-filesystem-invalidated', target }))
    expect(other.send).not.toHaveBeenCalled()
  })
})
