// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { emptyRepo, replaceRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { isRepoStatusRefreshable, useRepoStatusRefresh } from '#/web/hooks/useRepoStatusRefresh.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore } from '#/web/test-utils/bridge.ts'
import { preferredWorkspacePaneTabByBranchRecordWith } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { workspacePaneTabOrderRecordWith } from '#/web/stores/repos/workspace-pane-tabs.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabOrderEntry } from '#/shared/workspace-pane.ts'

const originalRefreshStatus = useReposStore.getState().refreshStatus

function Harness() {
  useRepoStatusRefresh()
  return null
}

function createRepo(
  id: string,
  options: {
    preferredWorkspacePaneTab?: WorkspacePaneTabType
    /**
     * Phase 4: the legacy `availability.phase` field is gone for
     * remote repos. The snapshot's `unavailable` boolean is
     * computed by `isRepoUnavailable(repo)`. For local repos
     * (which these tests are about), the field is set via
     * `availability.phase`. The factory below just routes the
     * test's intent through whichever legacy field still works
     * — the snapshot tests don't care which storage the
     * boolean came from.
     */
    unavailable?: boolean
    statusPhase?: 'idle' | 'loading' | 'refreshing'
  } = {},
) {
  const repo = emptyRepo(id, 'repo')
  repo.instanceToken = id === '/repo-a' ? 1 : 2
  repo.ui.selectedBranch = 'main'
  repo.ui.workspacePaneTabOrderByBranch = workspacePaneTabOrderRecordWith(repo.ui, 'main', [
    workspacePaneStaticTabOrderEntry('status'),
  ])
  repo.ui.preferredWorkspacePaneTabByBranch = preferredWorkspacePaneTabByBranchRecordWith(
    repo.ui,
    'main',
    options.preferredWorkspacePaneTab ?? 'status',
  )
  if (options.unavailable) repo.availability = { phase: 'unavailable', reason: 'error.failed-read-repo', checkedAt: 0 }
  repo.dataLoads.status.phase = options.statusPhase ?? 'idle'
  return repo
}

describe('isRepoStatusRefreshable', () => {
  test('returns true for an idle, available repo', () => {
    expect(
      isRepoStatusRefreshable({
        id: '/r',
        token: 1,
        preferredWorkspacePaneTab: 'status',
        statusViewOpen: true,
        unavailable: false,
        statusPhase: 'idle',
      }),
    ).toBe(true)
  })

  test('returns false when availability is unavailable', () => {
    expect(
      isRepoStatusRefreshable({
        id: '/r',
        token: 1,
        preferredWorkspacePaneTab: 'status',
        statusViewOpen: true,
        unavailable: true,
        statusPhase: 'idle',
      }),
    ).toBe(false)
  })

  test('returns false when a refresh is already in flight', () => {
    expect(
      isRepoStatusRefreshable({
        id: '/r',
        token: 1,
        preferredWorkspacePaneTab: 'status',
        statusViewOpen: true,
        unavailable: false,
        statusPhase: 'loading',
      }),
    ).toBe(false)
    expect(
      isRepoStatusRefreshable({
        id: '/r',
        token: 1,
        preferredWorkspacePaneTab: 'status',
        statusViewOpen: true,
        unavailable: false,
        statusPhase: 'refreshing',
      }),
    ).toBe(false)
  })
})

describe('useRepoStatusRefresh', () => {
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

  test('refreshes status when switching to another active repo', async () => {
    const repoA = createRepo('/repo-a')
    const repoB = createRepo('/repo-b')
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

  test('refreshes status when opening the status tab', async () => {
    const repo = createRepo('/repo-a', { preferredWorkspacePaneTab: 'terminal' })
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
      useReposStore.getState().setWorkspacePaneTab('/repo-a', 'status')
    })

    expect(refreshStatus).toHaveBeenCalledWith('/repo-a', { token: 1 })
  })

  test('refreshes status when opening the changes tab', async () => {
    const repo = createRepo('/repo-a', { preferredWorkspacePaneTab: 'terminal' })
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
      useReposStore.getState().setWorkspacePaneTab('/repo-a', 'changes')
    })

    expect(refreshStatus).toHaveBeenCalledWith('/repo-a', { token: 1 })
  })

  test('refreshes status when reopening the status tab after bouncing through terminal', async () => {
    const repo = createRepo('/repo-a', { preferredWorkspacePaneTab: 'status' })
    repo.data.branches = [
      {
        name: 'main',
        isCurrent: true,
        isDefault: true,
        worktree: { path: '/repo-a/main' },
        ahead: 0,
        behind: 0,
        tracking: '',
        trackingGone: false,
        lastCommitHash: '',
        lastCommitMessage: '',
        lastCommitAuthor: '',
        lastCommitDate: '',
        mergedToDefault: undefined,
      },
    ]
    repo.ui.selectedBranch = 'main'
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
      useReposStore.getState().setWorkspacePaneTab('/repo-a', 'terminal')
    })
    expect(refreshStatus).not.toHaveBeenCalled()

    await act(async () => {
      useReposStore.getState().setWorkspacePaneTab('/repo-a', 'status')
    })
    expect(refreshStatus).toHaveBeenCalledWith('/repo-a', { token: 1 })
  })

  test('skips refresh when the repo is unavailable', async () => {
    const repo = createRepo('/repo-a', { unavailable: true })
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
      useReposStore.getState().setWorkspacePaneTab('/repo-a', 'status')
    })

    expect(refreshStatus).not.toHaveBeenCalled()
  })

  test('skips refresh when a status refresh is already in flight', async () => {
    const repo = createRepo('/repo-a', { statusPhase: 'loading' })
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
      useReposStore.getState().setWorkspacePaneTab('/repo-a', 'status')
    })

    expect(refreshStatus).not.toHaveBeenCalled()
  })

  test('does not treat branch selection changes as refresh triggers', async () => {
    const repo = createRepo('/repo-a', { preferredWorkspacePaneTab: 'status' })
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
