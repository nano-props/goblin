// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRestoreRepoTabsOnView } from '#/web/hooks/useRestoreRepoTabsOnView.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

const mocks = vi.hoisted(() => ({
  restoreRepoTabsOnView: vi.fn(),
  hydrateRestoredWorkspaceRuntime: vi.fn(),
  toastError: vi.fn(),
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

vi.mock('#/web/stores/repos/store.ts', async (importActual) => {
  const actual = await importActual<typeof import('#/web/stores/repos/store.ts')>()
  return {
    ...actual,
    useReposStore: Object.assign(
      vi.fn(actual.useReposStore),
      {
        getState: () => ({
          repos: {},
          hydrateRestoredWorkspaceRuntime: mocks.hydrateRestoredWorkspaceRuntime,
        }),
      },
    ),
  }
})

function stubRepo(id: string, repoRuntimeId: string) {
  return {
    id,
    repoRuntimeId,
    dataLoads: {
      repoReadModel: { phase: 'idle', loadedAt: null, error: null, stale: false },
    },
  }
}

describe('useRestoreRepoTabsOnView', () => {
  afterEach(() => {
    mocks.restoreRepoTabsOnView.mockReset()
    mocks.hydrateRestoredWorkspaceRuntime.mockReset()
    mocks.toastError.mockReset()
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
    vi.spyOn(useReposStore, 'getState').mockReturnValue({
      repos: {
        'repo-a': {
          id: 'repo-a',
          repoRuntimeId: 'rta',
          dataLoads: { repoReadModel: { phase: 'idle', loadedAt: 1, error: null, stale: false } },
        },
      },
    } as never)
    renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.restoreRepoTabsOnView).not.toHaveBeenCalled())
  })

  test('on success, hydrates the store with the returned repo and snapshot', async () => {
    function Host() {
      useRestoreRepoTabsOnView({ repoId: 'repo-a' })
      return null
    }
    vi.spyOn(useReposStore, 'getState').mockReturnValue({
      repos: { 'repo-a': stubRepo('repo-a', 'rta') },
      hydrateRestoredWorkspaceRuntime: mocks.hydrateRestoredWorkspaceRuntime,
    } as never)
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
    vi.spyOn(useReposStore, 'getState').mockReturnValue({
      repos: { 'repo-a': stubRepo('repo-a', 'rta') },
      hydrateRestoredWorkspaceRuntime: mocks.hydrateRestoredWorkspaceRuntime,
    } as never)
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
    vi.spyOn(useReposStore, 'getState').mockReturnValue({
      repos: { 'repo-a': stubRepo('repo-a', 'rta') },
      hydrateRestoredWorkspaceRuntime: mocks.hydrateRestoredWorkspaceRuntime,
    } as never)
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
    vi.spyOn(useReposStore, 'getState').mockReturnValue({
      repos: { 'repo-retry': stubRepo('repo-retry', 'rtr') },
      hydrateRestoredWorkspaceRuntime: mocks.hydrateRestoredWorkspaceRuntime,
    } as never)
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
    vi.spyOn(useReposStore, 'getState').mockReturnValue({
      repos: { 'repo-dedupe': stubRepo('repo-dedupe', 'rtd') },
      hydrateRestoredWorkspaceRuntime: mocks.hydrateRestoredWorkspaceRuntime,
    } as never)

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
})