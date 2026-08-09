import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ServerInvalidationEvent } from '#/shared/server-invalidation.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { subscribeRepoReadInvalidation } from '#/web/repo-read-invalidation-ingress.ts'
import { subscribeServerInvalidationIngress } from '#/web/server-invalidation-ingress.ts'

const mocks = vi.hoisted(() => ({
  listener: null as ((event: ServerInvalidationEvent) => void) | null,
  onOpen: null as (() => void) | null,
  dispose: vi.fn(),
}))

vi.mock('#/web/server-invalidation-ingress.ts', () => ({
  subscribeServerInvalidationIngress: vi.fn(
    (listener: (event: ServerInvalidationEvent) => void, onOpen?: () => void) => {
      mocks.listener = listener
      mocks.onOpen = onOpen ?? null
      return mocks.dispose
    },
  ),
}))

describe('repo read invalidation ingress', () => {
  beforeEach(() => {
    mocks.listener = null
    mocks.onOpen = null
    mocks.dispose.mockReset()
  })

  test('forwards repo read invalidations and returns the shared subscription disposer', () => {
    const listener = vi.fn()
    const dispose = subscribeRepoReadInvalidation(listener)
    const event = {
      type: 'repo-read-invalidated' as const,
      repoId: workspaceIdForTest('goblin+file:///workspace'),
      domain: 'metadata' as const,
    }

    mocks.listener?.(event)

    expect(subscribeServerInvalidationIngress).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(event)
    expect(dispose).toBe(mocks.dispose)
  })

  test('ignores invalidations owned by other projections', () => {
    const listener = vi.fn()
    subscribeRepoReadInvalidation(listener)

    mocks.listener?.({ type: 'settings-invalidated', scopes: ['theme'] })

    expect(listener).not.toHaveBeenCalled()
  })

  test('forwards the shared connection-open signal', () => {
    const onOpen = vi.fn()
    subscribeRepoReadInvalidation(vi.fn(), onOpen)

    mocks.onOpen?.()

    expect(onOpen).toHaveBeenCalledOnce()
  })
})
