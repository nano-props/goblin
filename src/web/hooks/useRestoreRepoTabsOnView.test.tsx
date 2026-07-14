// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRestoreRepoTabsOnView } from '#/web/hooks/useRestoreRepoTabsOnView.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

const mocks = vi.hoisted(() => ({
  restoreRepoTabsOnView: vi.fn(),
  updateRepoRuntimeCache: vi.fn(),
  writeWorkspacePaneTabsSnapshotQueryData: vi.fn(),
  hydrateRestoredWorkspaceRuntime: vi.fn(),
}))

vi.mock('#/web/settings-actions.ts', () => ({
  restoreRepoTabsOnView: mocks.restoreRepoTabsOnView,
}))
vi.mock('#/web/repo-runtime-query.ts', () => ({
  updateRepoRuntimeCache: mocks.updateRepoRuntimeCache,
}))
vi.mock('#/web/workspace-pane/workspace-pane-tabs-query.ts', () => ({
  writeWorkspacePaneTabsSnapshotQueryData: mocks.writeWorkspacePaneTabsSnapshotQueryData,
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

describe('useRestoreRepoTabsOnView', () => {
  test('does nothing when hydratedRouteRepoId is null', async () => {
    function Host() {
      useRestoreRepoTabsOnView({ hydratedRouteRepoId: null })
      return null
    }
    renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.restoreRepoTabsOnView).not.toHaveBeenCalled())
  })

  test('does nothing when the repo is already restored (loadedAt set)', async () => {
    function Host() {
      useRestoreRepoTabsOnView({ hydratedRouteRepoId: 'repo-a' })
      return null
    }
    // Spy on the underlying store state to short-circuit the check.
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
})