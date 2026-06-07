// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resetRepoRefreshCoordinatorState } from '#/web/stores/repos/refresh-coordinator.ts'
import {
  beginRepoInvalidationSource,
  settleRepoInvalidationSource,
} from '#/web/stores/repos/invalidation-sources.ts'
import { useRepoStoreInvalidationRefresh } from '#/web/hooks/useRepoStoreInvalidationRefresh.ts'

const listeners = new Set<(event: any) => void>()
const storeState = {
  repos: {
    '/tmp/repo': {
      id: '/tmp/repo',
      availability: { phase: 'available' },
      instanceToken: 7,
      resources: {
        snapshot: { phase: 'idle', loadedAt: 0, stale: false, error: null },
        status: { phase: 'idle', loadedAt: 0, stale: false, error: null },
      },
    },
  },
  refreshSnapshot: vi.fn(),
  refreshStatus: vi.fn(),
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
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    resetRepoRefreshCoordinatorState()
    storeState.refreshSnapshot.mockReset()
    storeState.refreshStatus.mockReset()
    storeState.repos['/tmp/repo'] = {
      id: '/tmp/repo',
      availability: { phase: 'available' },
      instanceToken: 7,
      resources: {
        snapshot: { phase: 'idle', loadedAt: Date.now(), stale: false, error: null },
        status: { phase: 'idle', loadedAt: Date.now(), stale: false, error: null },
      },
    }
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    listeners.clear()
    resetRepoRefreshCoordinatorState()
    vi.useRealTimers()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  test('refreshes snapshot and status when a repo-snapshot invalidation arrives', async () => {
    await act(async () => {
      root.render(<Harness />)
    })

    await act(async () => {
      for (const listener of listeners)
        listener({ type: 'repo-query-invalidated', repoId: '/tmp/repo', query: 'repo-snapshot' })
    })

    expect(storeState.refreshSnapshot).toHaveBeenCalledWith('/tmp/repo', { token: 7 })
    expect(storeState.refreshStatus).toHaveBeenCalledWith('/tmp/repo', { token: 7 })
  })

  test('skips duplicate invalidation refreshes from an active local source token', async () => {
    beginRepoInvalidationSource('repo_branch_1')

    await act(async () => {
      root.render(<Harness />)
    })

    await act(async () => {
      for (const listener of listeners)
        listener({ type: 'repo-query-invalidated', repoId: '/tmp/repo', query: 'repo-snapshot', sourceToken: 'repo_branch_1' })
    })

    expect(storeState.refreshSnapshot).not.toHaveBeenCalled()
    expect(storeState.refreshStatus).not.toHaveBeenCalled()
  })

  test('skips duplicate invalidation refreshes from a recently settled local source token', async () => {
    beginRepoInvalidationSource('repo_manual_1')
    settleRepoInvalidationSource('repo_manual_1')

    await act(async () => {
      root.render(<Harness />)
    })

    await act(async () => {
      for (const listener of listeners)
        listener({ type: 'repo-query-invalidated', repoId: '/tmp/repo', query: 'repo-snapshot', sourceToken: 'repo_manual_1' })
    })

    expect(storeState.refreshSnapshot).not.toHaveBeenCalled()
    expect(storeState.refreshStatus).not.toHaveBeenCalled()
  })

  test('refreshes when invalidation source token does not match a local action', async () => {
    beginRepoInvalidationSource('repo_manual_2')

    await act(async () => {
      root.render(<Harness />)
    })

    await act(async () => {
      for (const listener of listeners)
        listener({ type: 'repo-query-invalidated', repoId: '/tmp/repo', query: 'repo-snapshot', sourceToken: 'repo_manual_other' })
    })

    expect(storeState.refreshSnapshot).toHaveBeenCalledWith('/tmp/repo', { token: 7 })
    expect(storeState.refreshStatus).toHaveBeenCalledWith('/tmp/repo', { token: 7 })
  })
})
