import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  publishRepoReadInvalidation,
  publishUserWorkspaceFilesystemInvalidation,
  publishUserRepoReadInvalidation,
  publishUserWorkspaceRuntimeInvalidation,
} from '#/server/realtime/invalidation-broker.ts'
import { disconnectAllNotificationSockets, registerNotificationSocket } from '#/server/realtime/notification-broker.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

describe('invalidation broker', () => {
  const workspaceId = workspaceIdForTest('goblin+file:///workspace')

  beforeEach(() => {
    disconnectAllNotificationSockets()
  })

  test('fans user-scoped invalidations only to sockets for that identity', () => {
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }
    registerNotificationSocket(first, 'user_a')
    registerNotificationSocket(second, 'user_b')

    publishUserRepoReadInvalidation('user_a', { repoId: workspaceId, domain: 'operations' })

    expect(first.send).toHaveBeenCalledOnce()
    expect(second.send).not.toHaveBeenCalled()
  })

  test('removes a socket after delivery fails', () => {
    const socket = {
      send: vi.fn(() => {
        throw new Error('socket closed')
      }),
      close: vi.fn(),
    }
    registerNotificationSocket(socket, 'user_a')

    publishRepoReadInvalidation({ repoId: workspaceId, domain: 'metadata' })
    publishRepoReadInvalidation({ repoId: workspaceId, domain: 'metadata' })

    expect(socket.send).toHaveBeenCalledOnce()
  })

  test('publishes workspace runtime invalidations with canonical workspace identity', () => {
    const socket = { send: vi.fn(), close: vi.fn() }
    registerNotificationSocket(socket, 'user_a')
    const workspaceId = workspaceIdForTest('goblin+ssh://example/workspace')

    publishUserWorkspaceRuntimeInvalidation('user_a', { workspaceId })

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'workspace-runtime-invalidated', workspaceId }))
  })

  test('publishes filesystem invalidations only to the owning user', () => {
    const owner = { send: vi.fn(), close: vi.fn() }
    const other = { send: vi.fn(), close: vi.fn() }
    registerNotificationSocket(owner, 'user_a')
    registerNotificationSocket(other, 'user_b')
    const workspaceId = workspaceIdForTest('goblin+file:///workspace')
    const target = { kind: 'workspace-root' as const, workspaceId, workspaceRuntimeId: 'workspace-runtime-test' }

    publishUserWorkspaceFilesystemInvalidation('user_a', { target })

    expect(owner.send).toHaveBeenCalledWith(JSON.stringify({ type: 'workspace-filesystem-invalidated', target }))
    expect(other.send).not.toHaveBeenCalled()
  })
})
