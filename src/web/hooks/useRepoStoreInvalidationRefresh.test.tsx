// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRepoStoreInvalidationRefresh } from '#/web/hooks/useRepoStoreInvalidationRefresh.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoDataQueryKey } from '#/web/repo-data-query.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')

const listeners = new Set<(event: any) => void>()
const storeState = {
  workspaces: {
    [WORKSPACE_ID]: {
      id: WORKSPACE_ID,
      availability: { phase: 'available' },
      workspaceRuntimeId: 'repo-runtime-test-7',
      dataLoads: {
        repoReadModel: { phase: 'idle', loadedAt: 0, stale: false, error: null },
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

vi.mock('#/web/stores/workspaces/store.ts', () => ({
  useWorkspacesStore: {
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
    storeState.workspaces[WORKSPACE_ID] = {
      id: WORKSPACE_ID,
      availability: { phase: 'available' },
      workspaceRuntimeId: 'repo-runtime-test-7',
      dataLoads: {
        repoReadModel: { phase: 'idle', loadedAt: Date.now(), stale: false, error: null },
        fetch: { phase: 'idle', loadedAt: Date.now(), stale: false, error: null },
      },
    }
  })

  afterEach(() => {
    listeners.clear()
    primaryWindowQueryClient.clear()
    vi.useRealTimers()
  })

  test('handles repo-snapshot invalidations through query invalidation only', async () => {
    const invalidateSpy = vi.spyOn(primaryWindowQueryClient, 'invalidateQueries')
    renderInJsdom(<Harness />)

    await act(async () => {
      for (const listener of listeners)
        listener({ type: 'repo-query-invalidated', repoId: WORKSPACE_ID, query: 'repo-snapshot' })
    })

    expect(invalidateSpy).toHaveBeenCalledWith(
      {
        queryKey: repoDataQueryKey(WORKSPACE_ID, 'repo-runtime-test-7'),
        refetchType: 'active',
      },
      { cancelRefetch: false },
    )
    invalidateSpy.mockRestore()
  })

  test('handles repo-runtime invalidations through runtime projection query invalidation', async () => {
    const invalidateSpy = vi.spyOn(primaryWindowQueryClient, 'invalidateQueries')
    renderInJsdom(<Harness />)

    await act(async () => {
      for (const listener of listeners)
        listener({ type: 'repo-query-invalidated', repoId: WORKSPACE_ID, query: 'repo-runtime' })
    })

    expect(invalidateSpy).toHaveBeenCalledWith(
      {
        queryKey: ['repo-data', WORKSPACE_ID, 'repo-runtime-test-7', 'projection'],
        refetchType: 'active',
      },
      { cancelRefetch: false },
    )
    expect(invalidateSpy).toHaveBeenCalledWith(
      {
        queryKey: ['repo-data', WORKSPACE_ID, 'repo-runtime-test-7', 'operations'],
        refetchType: 'active',
      },
      { cancelRefetch: false },
    )
    invalidateSpy.mockRestore()
  })

  test('refreshes invalidations even when extra transport metadata is present', async () => {
    const invalidateSpy = vi.spyOn(primaryWindowQueryClient, 'invalidateQueries')
    renderInJsdom(<Harness />)

    await act(async () => {
      for (const listener of listeners)
        listener({
          type: 'repo-query-invalidated',
          repoId: WORKSPACE_ID,
          query: 'repo-snapshot',
          ignoredMetadata: 'repo_manual_other',
        })
    })

    expect(invalidateSpy).toHaveBeenCalledWith(
      {
        queryKey: repoDataQueryKey(WORKSPACE_ID, 'repo-runtime-test-7'),
        refetchType: 'active',
      },
      { cancelRefetch: false },
    )
    invalidateSpy.mockRestore()
  })
})
