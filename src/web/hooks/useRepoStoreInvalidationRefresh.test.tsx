// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRepoStoreInvalidationRefresh } from '#/web/hooks/useRepoStoreInvalidationRefresh.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoDataQueryKey } from '#/web/repo-query-keys.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')

const listeners = new Set<(event: any) => void>()
function workspace() {
  const value = emptyWorkspace(WORKSPACE_ID, 'workspace', 'repo-runtime-test-7')
  acceptWorkspaceProbeState(value, {
    status: 'ready',
    name: 'workspace',
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
    },
    diagnostics: [],
  })
  return value
}
const storeState = {
  workspaces: {
    [WORKSPACE_ID]: workspace(),
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
    storeState.workspaces[WORKSPACE_ID] = workspace()
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
        predicate: expect.any(Function),
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
    expect(invalidateSpy).toHaveBeenCalledTimes(2)
    invalidateSpy.mockRestore()
  })

  test('limits repo-runtime invalidations to operation queries', async () => {
    const invalidateSpy = vi.spyOn(primaryWindowQueryClient, 'invalidateQueries')
    renderInJsdom(<Harness />)

    await act(async () => {
      for (const listener of listeners)
        listener({ type: 'repo-query-invalidated', repoId: WORKSPACE_ID, query: 'repo-runtime' })
    })

    expect(invalidateSpy).toHaveBeenCalledWith(
      {
        queryKey: ['repo-data', WORKSPACE_ID, 'repo-runtime-test-7', 'operations'],
        refetchType: 'active',
      },
      { cancelRefetch: false },
    )
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
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
        predicate: expect.any(Function),
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
    expect(invalidateSpy).toHaveBeenCalledTimes(2)
    invalidateSpy.mockRestore()
  })
})
