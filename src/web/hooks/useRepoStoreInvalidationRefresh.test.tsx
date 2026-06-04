// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useRepoStoreInvalidationRefresh } from '#/web/hooks/useRepoStoreInvalidationRefresh.ts'

const listeners = new Set<(event: any) => void>()
const storeState = {
  repos: {
    '/tmp/repo': { availability: { phase: 'available' }, instanceToken: 7 },
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
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    storeState.refreshSnapshot.mockReset()
    storeState.refreshStatus.mockReset()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    listeners.clear()
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
})
