// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { resetRepoRefreshCoordinatorState } from '#/web/stores/repos/refresh-coordinator.ts'
import { useRepoStoreInvalidationRefresh } from '#/web/hooks/useRepoStoreInvalidationRefresh.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoDataQueryKey } from '#/web/repo-data-query.ts'

const listeners = new Set<(event: any) => void>()
const storeState = {
  repos: {
    '/tmp/repo': {
      id: '/tmp/repo',
      availability: { phase: 'available' },
      repoRuntimeId: 'repo-runtime-test-7',
      dataLoads: {
        repoReadModel: { phase: 'idle', loadedAt: 0, stale: false, error: null },
        visibleStatus: { phase: 'idle', loadedAt: 0, stale: false, error: null },
        fetch: { phase: 'idle', loadedAt: 0, stale: false, error: null },
      },
    },
  },
}

vi.mock('#/web/repo-query-invalidation-ingress.ts', () => ({
  subscribeRepoQueryInvalidation(listener: (event: any) => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}))

vi.mock('#/web/stores/repos/store.ts', () => ({
  useReposStore: {
    getState: () => storeState,
    setState: vi.fn(),
  },
}))

function Harness() {
  useRepoStoreInvalidationRefresh()
  return null
}

describe('useRepoStoreInvalidationRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    listeners.clear()
    primaryWindowQueryClient.clear()
    resetRepoRefreshCoordinatorState()
    storeState.repos['/tmp/repo'] = {
      id: '/tmp/repo',
      availability: { phase: 'available' },
      repoRuntimeId: 'repo-runtime-test-7',
      dataLoads: {
        repoReadModel: { phase: 'idle', loadedAt: Date.now(), stale: false, error: null },
        visibleStatus: { phase: 'idle', loadedAt: Date.now(), stale: false, error: null },
        fetch: { phase: 'idle', loadedAt: Date.now(), stale: false, error: null },
      },
    }
  })

  afterEach(() => {
    listeners.clear()
    primaryWindowQueryClient.clear()
    resetRepoRefreshCoordinatorState()
    vi.useRealTimers()
  })

  test('handles repo-snapshot invalidations through query invalidation only', async () => {
    const invalidateSpy = vi.spyOn(primaryWindowQueryClient, 'invalidateQueries')
    renderInJsdom(<Harness />)

    await act(async () => {
      for (const listener of listeners)
        listener({ type: 'repo-query-invalidated', repoId: '/tmp/repo', query: 'repo-snapshot' })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: repoDataQueryKey('/tmp/repo', 'repo-runtime-test-7'),
      refetchType: 'none',
    })
    invalidateSpy.mockRestore()
  })

  test('handles repo-runtime invalidations through runtime projection query invalidation', async () => {
    const invalidateSpy = vi.spyOn(primaryWindowQueryClient, 'invalidateQueries')
    const refetchSpy = vi.spyOn(primaryWindowQueryClient, 'refetchQueries')
    renderInJsdom(<Harness />)

    await act(async () => {
      for (const listener of listeners)
        listener({ type: 'repo-query-invalidated', repoId: '/tmp/repo', query: 'repo-runtime' })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['repo-data', '/tmp/repo', 'repo-runtime-test-7', 'projection'],
      refetchType: 'none',
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['repo-data', '/tmp/repo', 'repo-runtime-test-7', 'operations'],
      refetchType: 'none',
    })
    expect(refetchSpy).toHaveBeenCalledWith(
      { queryKey: ['repo-data', '/tmp/repo', 'repo-runtime-test-7', 'projection'], type: 'active' },
      { cancelRefetch: false },
    )
    expect(refetchSpy).toHaveBeenCalledWith(
      { queryKey: ['repo-data', '/tmp/repo', 'repo-runtime-test-7', 'operations'], type: 'active' },
      { cancelRefetch: false },
    )
    refetchSpy.mockRestore()
    invalidateSpy.mockRestore()
  })

  test('refreshes invalidations even when extra transport metadata is present', async () => {
    const invalidateSpy = vi.spyOn(primaryWindowQueryClient, 'invalidateQueries')
    renderInJsdom(<Harness />)

    await act(async () => {
      for (const listener of listeners)
        listener({
          type: 'repo-query-invalidated',
          repoId: '/tmp/repo',
          query: 'repo-snapshot',
          ignoredMetadata: 'repo_manual_other',
        })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: repoDataQueryKey('/tmp/repo', 'repo-runtime-test-7'),
      refetchType: 'none',
    })
    invalidateSpy.mockRestore()
  })
})
