import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ServerInvalidationEvent } from '#/shared/server-invalidation.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { subscribeRepoQueryInvalidation } from '#/web/repo-query-invalidation-ingress.ts'
import { subscribeServerInvalidationIngress } from '#/web/server-invalidation-ingress.ts'

const mocks = vi.hoisted(() => ({
  listener: null as ((event: ServerInvalidationEvent) => void) | null,
  dispose: vi.fn(),
}))

vi.mock('#/web/server-invalidation-ingress.ts', () => ({
  subscribeServerInvalidationIngress: vi.fn((listener: (event: ServerInvalidationEvent) => void) => {
    mocks.listener = listener
    return mocks.dispose
  }),
}))

describe('repo query invalidation ingress', () => {
  beforeEach(() => {
    mocks.listener = null
    mocks.dispose.mockReset()
  })

  test('forwards repo query invalidations and returns the shared subscription disposer', () => {
    const listener = vi.fn()
    const dispose = subscribeRepoQueryInvalidation(listener)
    const event = {
      type: 'repo-query-invalidated' as const,
      repoId: workspaceIdForTest('goblin+file:///workspace'),
      query: 'repo-snapshot' as const,
    }

    mocks.listener?.(event)

    expect(subscribeServerInvalidationIngress).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(event)
    expect(dispose).toBe(mocks.dispose)
  })

  test('ignores invalidations owned by other projections', () => {
    const listener = vi.fn()
    subscribeRepoQueryInvalidation(listener)

    mocks.listener?.({ type: 'settings-invalidated', scopes: ['theme'] })

    expect(listener).not.toHaveBeenCalled()
  })
})
