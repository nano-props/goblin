// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { emptyRepo, replaceRepo } from '#/web/stores/repos/helpers.ts'
import { useHeuristicRepoStatusRefresh } from '#/web/hooks/useHeuristicRepoStatusRefresh.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore } from '#/web/stores/repos/test-utils.ts'

const originalRefreshStatus = useReposStore.getState().refreshStatus

function Harness() {
  useHeuristicRepoStatusRefresh()
  return null
}

function createRepo(
  id: string,
  options: {
    detailTab?: 'status' | 'changes' | 'terminal'
    statusLoaded?: boolean
    statusLoadedAt?: number | null
    statusStale?: boolean
  } = {},
) {
  const repo = emptyRepo(id, 'repo')
  repo.instanceToken = id === '/repo-a' ? 1 : 2
  repo.ui.detailTab = options.detailTab ?? 'status'
  repo.data.statusLoaded = options.statusLoaded ?? true
  repo.resources.status.loadedAt = options.statusLoadedAt ?? null
  repo.resources.status.stale = options.statusStale ?? false
  return repo
}

describe('useHeuristicRepoStatusRefresh', () => {
  let container: HTMLDivElement
  let root: Root
  let refreshStatus: ReturnType<typeof vi.fn>

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    resetReposStore()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    refreshStatus = vi.fn().mockResolvedValue(undefined)
    useReposStore.setState({ refreshStatus: refreshStatus as typeof originalRefreshStatus })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    resetReposStore()
    useReposStore.setState({ refreshStatus: originalRefreshStatus })
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  test('refreshes status when switching to an active repo with stale status data', async () => {
    const now = Date.now()
    const repoA = createRepo('/repo-a', { statusLoadedAt: now })
    const repoB = createRepo('/repo-b', { statusLoadedAt: now - 20_000 })
    await act(async () => {
      useReposStore.setState({
        repos: { '/repo-a': repoA, '/repo-b': repoB },
        order: ['/repo-a', '/repo-b'],
        activeId: '/repo-a',
      })
      root.render(<Harness />)
    })
    refreshStatus.mockClear()

    await act(async () => {
      useReposStore.setState({ activeId: '/repo-b' })
    })

    expect(refreshStatus).toHaveBeenCalledWith('/repo-b', { token: 2 })
  })

  test('refreshes status when opening the changes tab with stale status data', async () => {
    const repo = createRepo('/repo-a', {
      detailTab: 'terminal',
      statusLoadedAt: Date.now() - 20_000,
    })
    await act(async () => {
      useReposStore.setState({
        repos: { '/repo-a': repo },
        order: ['/repo-a'],
        activeId: '/repo-a',
      })
      root.render(<Harness />)
    })
    refreshStatus.mockClear()

    await act(async () => {
      useReposStore.setState((state) => ({
        repos: {
          ...state.repos,
          '/repo-a': replaceRepo(state.repos['/repo-a']!, (draft) => {
            draft.ui.detailTab = 'changes'
          }),
        },
      }))
    })

    expect(refreshStatus).toHaveBeenCalledWith('/repo-a', { token: 1 })
  })

  test('refreshes status when opening the status tab with stale status data', async () => {
    const repo = createRepo('/repo-a', {
      detailTab: 'terminal',
      statusLoadedAt: Date.now() - 20_000,
    })
    await act(async () => {
      useReposStore.setState({
        repos: { '/repo-a': repo },
        order: ['/repo-a'],
        activeId: '/repo-a',
      })
      root.render(<Harness />)
    })
    refreshStatus.mockClear()

    await act(async () => {
      useReposStore.setState((state) => ({
        repos: {
          ...state.repos,
          '/repo-a': replaceRepo(state.repos['/repo-a']!, (draft) => {
            draft.ui.detailTab = 'status'
          }),
        },
      }))
    })

    expect(refreshStatus).toHaveBeenCalledWith('/repo-a', { token: 1 })
  })

  test('does not refresh status for fresh data when switching active repos', async () => {
    const now = Date.now()
    const repoA = createRepo('/repo-a', { statusLoadedAt: now })
    const repoB = createRepo('/repo-b', { statusLoadedAt: now - 1_000 })
    await act(async () => {
      useReposStore.setState({
        repos: { '/repo-a': repoA, '/repo-b': repoB },
        order: ['/repo-a', '/repo-b'],
        activeId: '/repo-a',
      })
      root.render(<Harness />)
    })
    refreshStatus.mockClear()

    await act(async () => {
      useReposStore.setState({ activeId: '/repo-b' })
    })

    expect(refreshStatus).not.toHaveBeenCalled()
  })

  test('does not treat branch selection changes as heuristic status refresh triggers', async () => {
    const repo = createRepo('/repo-a', {
      detailTab: 'status',
      statusLoadedAt: Date.now() - 20_000,
    })
    repo.ui.selectedBranch = 'feature/a'
    await act(async () => {
      useReposStore.setState({
        repos: { '/repo-a': repo },
        order: ['/repo-a'],
        activeId: '/repo-a',
      })
      root.render(<Harness />)
    })
    refreshStatus.mockClear()

    await act(async () => {
      useReposStore.setState((state) => ({
        repos: {
          ...state.repos,
          '/repo-a': replaceRepo(state.repos['/repo-a']!, (draft) => {
            draft.ui.selectedBranch = 'feature/b'
          }),
        },
      }))
    })

    expect(refreshStatus).not.toHaveBeenCalled()
  })
})
