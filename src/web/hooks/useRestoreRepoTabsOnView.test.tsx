// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRestoreRepoTabsOnView } from '#/web/hooks/useRestoreRepoTabsOnView.ts'

const mocks = vi.hoisted(() => ({
  restoreRepoTabsOnView: vi.fn(),
  promoteRestoredWorkspaceRepo: vi.fn(),
  toastError: vi.fn(),
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

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
    success: vi.fn(),
  },
}))

vi.mock('#/web/stores/i18n.ts', () => ({
  translate: (key: string) => {
    if (key === 'lazy-restore.failed') return 'Could not open repository'
    return key
  },
}))

vi.mock('#/web/stores/repos/store.ts', async (importActual) => {
  const actual = await importActual<typeof import('#/web/stores/repos/store.ts')>()
  return {
    ...actual,
    useReposStore: Object.assign(
      vi.fn((selector?: (state: typeof mocks.storeState) => unknown) => {
        return selector ? selector(mocks.storeState) : mocks.storeState
      }),
      {
        getState: () => mocks.storeState,
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
    mocks.restoreRepoTabsOnView.mockReset()
    mocks.promoteRestoredWorkspaceRepo.mockReset()
    mocks.toastError.mockReset()
    mocks.storeState = {
      repos: {},
      restoredSessionBaseline: null,
      promoteRestoredWorkspaceRepo: mocks.promoteRestoredWorkspaceRepo,
    }
    vi.restoreAllMocks()
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
    expect(mocks.toastError).not.toHaveBeenCalled()
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

    expect(mocks.promoteRestoredWorkspaceRepo).not.toHaveBeenCalled()
  })

  test('on failure, emits a toast and does not hydrate', async () => {
    function Host() {
      useRestoreRepoTabsOnView({ repoId: 'repo-a' })
      return null
    }
    mocks.storeState = {
      repos: { 'repo-a': stubRepo('repo-a', 'rta') },
      promoteRestoredWorkspaceRepo: mocks.promoteRestoredWorkspaceRepo,
    }
    mocks.restoreRepoTabsOnView.mockRejectedValue(new Error('disk gone'))

    renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
    expect(mocks.promoteRestoredWorkspaceRepo).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ description: 'disk gone' }),
    )
  })

  test('allows a later mount to retry after a failure', async () => {
    function Host() {
      useRestoreRepoTabsOnView({ repoId: 'repo-retry' })
      return null
    }
    mocks.storeState = {
      repos: { 'repo-retry': stubRepo('repo-retry', 'rtr') },
      promoteRestoredWorkspaceRepo: mocks.promoteRestoredWorkspaceRepo,
    }
    mocks.restoreRepoTabsOnView.mockRejectedValue(new Error('boom'))

    const first = renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
    first.unmount()

    const second = renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.restoreRepoTabsOnView).toHaveBeenCalledTimes(2))
    second.unmount()
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
      await waitFor(() => expect(mocks.promoteRestoredWorkspaceRepo).toHaveBeenCalledTimes(1))
    })
    hostA.unmount()
    hostB.unmount()
  })
})
