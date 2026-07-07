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
      instanceId: 'repo-instance-test-7',
      dataLoads: {
        repoReadModel: { phase: 'idle', loadedAt: 0, stale: false, error: null },
        visibleStatus: { phase: 'idle', loadedAt: 0, stale: false, error: null },
        fetch: { phase: 'idle', loadedAt: 0, stale: false, error: null },
      },
    },
  },
  refreshCoreData: vi.fn(),
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
    storeState.refreshCoreData.mockReset()
    storeState.repos['/tmp/repo'] = {
      id: '/tmp/repo',
      availability: { phase: 'available' },
      instanceId: 'repo-instance-test-7',
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

  test('refreshes the runtime projection when a repo-snapshot invalidation arrives', async () => {
    const invalidateSpy = vi.spyOn(primaryWindowQueryClient, 'invalidateQueries')
    renderInJsdom(<Harness />)

    await act(async () => {
      for (const listener of listeners)
        listener({ type: 'repo-query-invalidated', repoId: '/tmp/repo', query: 'repo-snapshot' })
    })

    expect(storeState.refreshCoreData).toHaveBeenCalledWith('/tmp/repo', { repoInstanceId: 'repo-instance-test-7' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: repoDataQueryKey('/tmp/repo', 'repo-instance-test-7') })
    invalidateSpy.mockRestore()
  })

  test('refreshes invalidations even when extra transport metadata is present', async () => {
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

    expect(storeState.refreshCoreData).toHaveBeenCalledWith('/tmp/repo', { repoInstanceId: 'repo-instance-test-7' })
  })
})
