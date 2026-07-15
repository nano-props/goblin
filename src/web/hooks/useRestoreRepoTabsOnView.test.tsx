// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRestoreRepoTabsOnView } from '#/web/hooks/useRestoreRepoTabsOnView.ts'

const mocks = vi.hoisted(() => ({
  restoreRepoTabsOnView: vi.fn(),
  promoteRestoredWorkspaceRepo: vi.fn(),
  storeState: {
    repos: {},
    restoredSessionBaseline: null,
    promoteRestoredWorkspaceRepo: vi.fn(),
  } as {
    repos: Record<string, ReturnType<typeof stubRepo> | undefined>
    restoredSessionBaseline?: import('#/shared/api-types.ts').ClientWorkspaceState | null
    promoteRestoredWorkspaceRepo: ReturnType<typeof vi.fn>
  },
}))

vi.mock('#/web/settings-actions.ts', () => ({
  restoreRepoTabsOnView: mocks.restoreRepoTabsOnView,
}))

vi.mock('#/web/client-terminal-id.ts', () => ({
  readOrCreateWebTerminalClientId: () => 'test-client-id',
}))

vi.mock('#/web/stores/repos/store.ts', async (importActual) => {
  const actual = await importActual<typeof import('#/web/stores/repos/store.ts')>()
  return {
    ...actual,
    useReposStore: Object.assign(
      vi.fn((selector?: (state: typeof mocks.storeState) => unknown) => {
        const state = {
          ...mocks.storeState,
        }
        return selector ? selector(state) : state
      }),
      {
        getState: () => ({
          ...mocks.storeState,
        }),
      },
    ),
  }
})

function stubRepo(
  id: string,
  repoRuntimeId: string,
  options: { projectionState?: 'projected' | 'stub'; loadedAt?: number | null } = {},
) {
  return {
    id,
    repoRuntimeId,
    session: {
      entry: { kind: 'local' as const, id },
      projectionState: options.projectionState ?? 'stub',
    },
    dataLoads: {
      repoReadModel: { phase: 'idle', loadedAt: options.loadedAt ?? null, error: null, stale: false },
    },
  }
}

describe('useRestoreRepoTabsOnView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mocks.restoreRepoTabsOnView.mockReset()
    mocks.promoteRestoredWorkspaceRepo.mockReset()
    mocks.storeState = {
      repos: {},
      restoredSessionBaseline: null,
      promoteRestoredWorkspaceRepo: mocks.promoteRestoredWorkspaceRepo,
    }
  })

  test('does nothing when repoId is null', async () => {
    function Host() {
      useRestoreRepoTabsOnView({ repoId: null })
      return null
    }
    renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.restoreRepoTabsOnView).not.toHaveBeenCalled())
  })

  test('does nothing when the repo is already client-owned', async () => {
    function Host() {
      useRestoreRepoTabsOnView({ repoId: 'repo-a' })
      return null
    }
    mocks.storeState = {
      repos: {
        'repo-a': stubRepo('repo-a', 'rta', { projectionState: 'projected', loadedAt: null }),
      },
      promoteRestoredWorkspaceRepo: mocks.promoteRestoredWorkspaceRepo,
    }
    renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.restoreRepoTabsOnView).not.toHaveBeenCalled())
  })

  test('restores a stub even when warm cache has populated loadedAt', async () => {
    function Host() {
      useRestoreRepoTabsOnView({ repoId: 'repo-a' })
      return null
    }
    mocks.storeState = {
      repos: {
        'repo-a': stubRepo('repo-a', 'rta', { projectionState: 'stub', loadedAt: 1 }),
      },
      promoteRestoredWorkspaceRepo: mocks.promoteRestoredWorkspaceRepo,
    }
    mocks.restoreRepoTabsOnView.mockResolvedValue({
      repo: { repoRoot: 'repo-a', repoRuntimeId: 'rta' },
      snapshot: null,
    })

    renderInJsdom(<Host />)

    await waitFor(() => expect(mocks.restoreRepoTabsOnView).toHaveBeenCalledTimes(1))
    expect(mocks.restoreRepoTabsOnView).toHaveBeenCalledWith('test-client-id', 'repo-a', 'rta', {
      kind: 'local',
      id: 'repo-a',
    })
    await waitFor(() => expect(mocks.promoteRestoredWorkspaceRepo).toHaveBeenCalledTimes(1))
  })

  test('on success, hydrates the store with the returned repo and snapshot', async () => {
    function Host() {
      useRestoreRepoTabsOnView({ repoId: 'repo-a' })
      return null
    }
    mocks.storeState = {
      repos: { 'repo-a': stubRepo('repo-a', 'rta') },
      promoteRestoredWorkspaceRepo: mocks.promoteRestoredWorkspaceRepo,
    }
    mocks.restoreRepoTabsOnView.mockResolvedValue({
      repo: { repoRoot: '/r/a', repoRuntimeId: 'rta' },
      snapshot: { tabs: [{ key: 'status' }] },
    })

    renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.restoreRepoTabsOnView).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.promoteRestoredWorkspaceRepo).toHaveBeenCalledTimes(1))
    expect(mocks.promoteRestoredWorkspaceRepo).toHaveBeenCalledWith({
      repo: { repoRoot: '/r/a', repoRuntimeId: 'rta' },
      snapshot: { tabs: [{ key: 'status' }] },
    })
  })

  test('on success with null snapshot, hydrates with empty workspacePaneTabs', async () => {
    function Host() {
      useRestoreRepoTabsOnView({ repoId: 'repo-a' })
      return null
    }
    mocks.storeState = {
      repos: { 'repo-a': stubRepo('repo-a', 'rta') },
      promoteRestoredWorkspaceRepo: mocks.promoteRestoredWorkspaceRepo,
    }
    mocks.restoreRepoTabsOnView.mockResolvedValue({
      repo: { repoRoot: '/r/a', repoRuntimeId: 'rta' },
      snapshot: null,
    })

    renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.promoteRestoredWorkspaceRepo).toHaveBeenCalledTimes(1))
    expect(mocks.promoteRestoredWorkspaceRepo).toHaveBeenCalledWith({
      repo: { repoRoot: '/r/a', repoRuntimeId: 'rta' },
      snapshot: null,
    })
  })

  test('does not apply a lazy restore response after the repo closes', async () => {
    let resolveFetch: ((value: unknown) => void) | null = null
    mocks.restoreRepoTabsOnView.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    mocks.storeState = {
      repos: { 'repo-a': stubRepo('repo-a', 'rta') },
      promoteRestoredWorkspaceRepo: mocks.promoteRestoredWorkspaceRepo,
    }

    function Host() {
      useRestoreRepoTabsOnView({ repoId: 'repo-a' })
      return null
    }

    renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.restoreRepoTabsOnView).toHaveBeenCalledTimes(1))

    mocks.storeState = {
      repos: {},
      promoteRestoredWorkspaceRepo: mocks.promoteRestoredWorkspaceRepo,
    }
    await act(async () => {
      resolveFetch?.({ repo: { repoRoot: 'repo-a', repoRuntimeId: 'rta' }, snapshot: null })
      await Promise.resolve()
    })

    expect(mocks.promoteRestoredWorkspaceRepo).toHaveBeenCalledTimes(1)
  })

  test('on failure, exposes a stable view-local failure and does not hydrate', async () => {
    function Host() {
      const restore = useRestoreRepoTabsOnView({ repoId: 'repo-a' })
      return <div>{restore.state.phase === 'failed' ? restore.state.message : restore.state.phase}</div>
    }
    mocks.storeState = {
      repos: { 'repo-a': stubRepo('repo-a', 'rta') },
      promoteRestoredWorkspaceRepo: mocks.promoteRestoredWorkspaceRepo,
    }
    mocks.restoreRepoTabsOnView.mockRejectedValue(new Error('disk gone'))

    const host = renderInJsdom(<Host />)
    await waitFor(() => expect(host.container.textContent).toBe('disk gone'))
    expect(mocks.promoteRestoredWorkspaceRepo).not.toHaveBeenCalled()
  })

  test('allows an explicit retry after a failure', async () => {
    function Host() {
      const restore = useRestoreRepoTabsOnView({ repoId: 'repo-retry' })
      return <button onClick={restore.retry}>{restore.state.phase === 'failed' ? restore.state.message : 'retry'}</button>
    }
    mocks.storeState = {
      repos: { 'repo-retry': stubRepo('repo-retry', 'rtr') },
      promoteRestoredWorkspaceRepo: mocks.promoteRestoredWorkspaceRepo,
    }
    mocks.restoreRepoTabsOnView
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ repo: { repoRoot: 'repo-retry', repoRuntimeId: 'rtr' }, snapshot: null })

    const host = renderInJsdom(<Host />)
    await waitFor(() => expect(host.container.textContent).toBe('boom'))
    await waitFor(() => expect(mocks.restoreRepoTabsOnView).toHaveBeenCalledTimes(1))
    host.container.querySelector('button')?.click()
    await waitFor(() => expect(mocks.restoreRepoTabsOnView).toHaveBeenCalledTimes(2))
    host.unmount()
  })

  test('concurrent mounts dedupe via the in-flight Map', async () => {
    let resolveFetch: ((value: unknown) => void) | null = null
    mocks.restoreRepoTabsOnView.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    mocks.storeState = {
      repos: { 'repo-dedupe': stubRepo('repo-dedupe', 'rtd') },
      promoteRestoredWorkspaceRepo: mocks.promoteRestoredWorkspaceRepo,
    }

    function Host() {
      useRestoreRepoTabsOnView({ repoId: 'repo-dedupe' })
      return null
    }
    // Two separate mounts before the in-flight promise settles: the second
    // must hit the dedupe Map instead of firing a second network call.
    const hostA = renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.restoreRepoTabsOnView).toHaveBeenCalledTimes(1))
    const hostB = renderInJsdom(<Host />)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mocks.restoreRepoTabsOnView).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFetch?.({ repo: { repoRoot: '/r/d', repoRuntimeId: 'rtd' }, snapshot: null })
      await waitFor(() => expect(mocks.promoteRestoredWorkspaceRepo).toHaveBeenCalledTimes(2))
    })
    hostA.unmount()
    hostB.unmount()
  })
})
