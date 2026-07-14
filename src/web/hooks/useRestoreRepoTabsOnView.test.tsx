// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRestoreRepoTabsOnView } from '#/web/hooks/useRestoreRepoTabsOnView.ts'

const mocks = vi.hoisted(() => ({
  restoreRepoTabsOnView: vi.fn(),
  hydrateRestoredWorkspaceRuntime: vi.fn(),
  toastError: vi.fn(),
  storeState: {
    repos: {},
    hydrateRestoredWorkspaceRuntime: vi.fn(),
  } as {
    repos: Record<string, ReturnType<typeof stubRepo> | undefined>
    hydrateRestoredWorkspaceRuntime: ReturnType<typeof vi.fn>
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
  translate: (key: string, params?: Record<string, string | number>) => {
    if (key === 'lazy-restore.failed') return 'Could not open repository'
    if (key === 'lazy-restore.gave-up') return `giving up after ${params?.attempts ?? 'missing'} attempts`
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

function stubRepo(id: string, repoRuntimeId: string) {
  return {
    id,
    repoRuntimeId,
    dataLoads: {
      repoReadModel: { phase: 'idle', loadedAt: null as number | null, error: null, stale: false },
    },
  }
}

describe('useRestoreRepoTabsOnView', () => {
  afterEach(() => {
    mocks.restoreRepoTabsOnView.mockReset()
    mocks.hydrateRestoredWorkspaceRuntime.mockReset()
    mocks.toastError.mockReset()
    mocks.storeState = {
      repos: {},
      hydrateRestoredWorkspaceRuntime: mocks.hydrateRestoredWorkspaceRuntime,
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

  test('does nothing when the repo is already restored (loadedAt set)', async () => {
    function Host() {
      useRestoreRepoTabsOnView({ repoId: 'repo-a' })
      return null
    }
    mocks.storeState = {
      repos: {
        'repo-a': {
          id: 'repo-a',
          repoRuntimeId: 'rta',
          dataLoads: { repoReadModel: { phase: 'idle', loadedAt: 1, error: null, stale: false } },
        },
      },
      hydrateRestoredWorkspaceRuntime: mocks.hydrateRestoredWorkspaceRuntime,
    }
    renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.restoreRepoTabsOnView).not.toHaveBeenCalled())
  })

  test('on success, hydrates the store with the returned repo and snapshot', async () => {
    function Host() {
      useRestoreRepoTabsOnView({ repoId: 'repo-a' })
      return null
    }
    mocks.storeState = {
      repos: { 'repo-a': stubRepo('repo-a', 'rta') },
      hydrateRestoredWorkspaceRuntime: mocks.hydrateRestoredWorkspaceRuntime,
    }
    mocks.restoreRepoTabsOnView.mockResolvedValue({
      repo: { repoRoot: '/r/a', repoRuntimeId: 'rta' },
      snapshot: { tabs: [{ key: 'status' }] },
    })

    renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.restoreRepoTabsOnView).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.hydrateRestoredWorkspaceRuntime).toHaveBeenCalledTimes(1))

    const call = mocks.hydrateRestoredWorkspaceRuntime.mock.calls[0]?.[0] as {
      repos: unknown[]
      workspacePaneTabs: { snapshot: unknown }[]
      restoredRepoId: string
    }
    expect(call.repos).toHaveLength(1)
    expect(call.workspacePaneTabs).toEqual([
      { repoRoot: '/r/a', repoRuntimeId: 'rta', snapshot: { tabs: [{ key: 'status' }] } },
    ])
    expect(call.restoredRepoId).toBe('/r/a')
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  test('on success with null snapshot, hydrates with empty workspacePaneTabs', async () => {
    function Host() {
      useRestoreRepoTabsOnView({ repoId: 'repo-a' })
      return null
    }
    mocks.storeState = {
      repos: { 'repo-a': stubRepo('repo-a', 'rta') },
      hydrateRestoredWorkspaceRuntime: mocks.hydrateRestoredWorkspaceRuntime,
    }
    mocks.restoreRepoTabsOnView.mockResolvedValue({
      repo: { repoRoot: '/r/a', repoRuntimeId: 'rta' },
      snapshot: null,
    })

    renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.hydrateRestoredWorkspaceRuntime).toHaveBeenCalledTimes(1))
    expect(mocks.hydrateRestoredWorkspaceRuntime.mock.calls[0]?.[0].workspacePaneTabs).toEqual([])
  })

  test('on failure, emits a toast and does not hydrate', async () => {
    function Host() {
      useRestoreRepoTabsOnView({ repoId: 'repo-a' })
      return null
    }
    mocks.storeState = {
      repos: { 'repo-a': stubRepo('repo-a', 'rta') },
      hydrateRestoredWorkspaceRuntime: mocks.hydrateRestoredWorkspaceRuntime,
    }
    mocks.restoreRepoTabsOnView.mockRejectedValue(new Error('disk gone'))

    renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
    expect(mocks.hydrateRestoredWorkspaceRuntime).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ description: 'disk gone' }),
    )
  })

  test('stops retrying after MAX_LAZY_RESTORE_ATTEMPTS (3) failures', async () => {
    function Host() {
      useRestoreRepoTabsOnView({ repoId: 'repo-retry' })
      return null
    }
    mocks.storeState = {
      repos: { 'repo-retry': stubRepo('repo-retry', 'rtr') },
      hydrateRestoredWorkspaceRuntime: mocks.hydrateRestoredWorkspaceRuntime,
    }
    // One controllable rejection queue so we know exactly when each call
    // settles — including the `.finally` that clears the in-flight Map.
    const rejections: Array<(err: Error) => void> = []
    mocks.restoreRepoTabsOnView.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejections.push(reject)
        }),
    )

    // Three sequential mounts → three attempts → gate closes.
    const hosts: Array<ReturnType<typeof renderInJsdom>> = []
    for (let i = 0; i < 3; i++) {
      const host = renderInJsdom(<Host />)
      hosts.push(host)
      await waitFor(() => expect(mocks.restoreRepoTabsOnView).toHaveBeenCalledTimes(i + 1))
      // Settle the call; await the resulting toast and the in-flight clear.
      await act(async () => {
        rejections.shift()?.(new Error('boom'))
        await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(i + 1))
      })
    }
    hosts.forEach((h) => h.unmount())

    // Fourth mount must be a no-op — attempts counter is at the cap.
    const finalHost = renderInJsdom(<Host />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mocks.restoreRepoTabsOnView).toHaveBeenCalledTimes(3)
    expect(mocks.toastError).toHaveBeenCalledTimes(3)
    expect(mocks.toastError).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ description: 'boom — giving up after 3 attempts' }),
    )
    finalHost.unmount()
  })

  test('concurrent mounts dedupe via the in-flight Map', async () => {
    let resolveFetch: ((value: unknown) => void) | null = null
    mocks.restoreRepoTabsOnView.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    // Use a unique repoRoot so the prior test's failure counter doesn't gate us.
    mocks.storeState = {
      repos: { 'repo-dedupe': stubRepo('repo-dedupe', 'rtd') },
      hydrateRestoredWorkspaceRuntime: mocks.hydrateRestoredWorkspaceRuntime,
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
      await waitFor(() => expect(mocks.hydrateRestoredWorkspaceRuntime).toHaveBeenCalledTimes(1))
    })
    hostA.unmount()
    hostB.unmount()
  })

  test('does not burn retry budget for stale runtime failures and retries after runtime changes', async () => {
    function Host() {
      useRestoreRepoTabsOnView({ repoId: 'repo-stale' })
      return null
    }
    mocks.storeState = {
      repos: { 'repo-stale': stubRepo('repo-stale', 'rt-old') },
      hydrateRestoredWorkspaceRuntime: mocks.hydrateRestoredWorkspaceRuntime,
    }
    mocks.restoreRepoTabsOnView
      .mockRejectedValueOnce(new Error('Server request failed (BAD_REQUEST: error.repo-runtime-stale)'))
      .mockResolvedValueOnce({ repo: { repoRoot: 'repo-stale', repoRuntimeId: 'rt-new' }, snapshot: null })

    const host = renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.restoreRepoTabsOnView).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mocks.toastError).not.toHaveBeenCalled()

    mocks.storeState = {
      repos: { 'repo-stale': stubRepo('repo-stale', 'rt-new') },
      hydrateRestoredWorkspaceRuntime: mocks.hydrateRestoredWorkspaceRuntime,
    }
    host.rerender(<Host />)

    await waitFor(() => expect(mocks.restoreRepoTabsOnView).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(mocks.hydrateRestoredWorkspaceRuntime).toHaveBeenCalledTimes(1))
  })
})
