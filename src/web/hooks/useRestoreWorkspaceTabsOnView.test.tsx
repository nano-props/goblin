// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { useRestoreWorkspaceTabsOnView } from '#/web/hooks/useRestoreWorkspaceTabsOnView.ts'
import type { ClientWorkspaceState } from '#/shared/api-types.ts'
import type * as WorkspacesStoreModule from '#/web/stores/workspaces/store.ts'

const WORKSPACE_A_ID = workspaceIdForTest('goblin+file:///workspaces/a')
const WORKSPACE_B_ID = workspaceIdForTest('goblin+file:///workspaces/b')
const RETRY_WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspaces/retry')
const DEDUPE_WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspaces/dedupe')

const mocks = vi.hoisted(() => ({
  restoreWorkspaceTabsOnView: vi.fn(),
  promoteRestoredWorkspace: vi.fn(),
  storeState: {
    workspaces: {},
    restoredClientWorkspaceBaseline: null,
    promoteRestoredWorkspace: vi.fn(),
  } as {
    workspaces: Record<string, ReturnType<typeof stubRepo> | undefined>
    restoredClientWorkspaceBaseline?: ClientWorkspaceState | null
    promoteRestoredWorkspace: ReturnType<typeof vi.fn>
  },
}))

vi.mock('#/web/settings-actions.ts', () => ({
  restoreWorkspaceTabsOnView: mocks.restoreWorkspaceTabsOnView,
}))

vi.mock('#/web/client-terminal-id.ts', () => ({
  readOrCreateWebTerminalClientId: () => 'test-client-id',
}))

vi.mock('#/web/stores/workspaces/store.ts', async (importActual) => {
  const actual = await importActual<typeof WorkspacesStoreModule>()
  return {
    ...actual,
    useWorkspacesStore: Object.assign(
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
  id: WorkspaceId,
  workspaceRuntimeId: string,
  options: { projectionState?: 'projected' | 'stub'; loadedAt?: number | null } = {},
) {
  return {
    id,
    workspaceRuntimeId,
    session: {
      entry: { kind: 'local' as const, id },
      projectionState: options.projectionState ?? 'stub',
    },
    dataLoads: {
      repoReadModel: { phase: 'idle', loadedAt: options.loadedAt ?? null, error: null, stale: false },
    },
  }
}

describe('useRestoreWorkspaceTabsOnView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mocks.restoreWorkspaceTabsOnView.mockReset()
    mocks.promoteRestoredWorkspace.mockReset()
    mocks.storeState = {
      workspaces: {},
      restoredClientWorkspaceBaseline: null,
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }
  })

  test('does nothing when repoId is null', async () => {
    function Host() {
      useRestoreWorkspaceTabsOnView({ workspaceId: null })
      return null
    }
    renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.restoreWorkspaceTabsOnView).not.toHaveBeenCalled())
  })

  test('does nothing when the repo is already client-owned', async () => {
    function Host() {
      useRestoreWorkspaceTabsOnView({ workspaceId: WORKSPACE_A_ID })
      return null
    }
    mocks.storeState = {
      workspaces: {
        [WORKSPACE_A_ID]: stubRepo(WORKSPACE_A_ID, 'rta', { projectionState: 'projected', loadedAt: null }),
      },
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }
    renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.restoreWorkspaceTabsOnView).not.toHaveBeenCalled())
  })

  test('restores a stub even when warm cache has populated loadedAt', async () => {
    function Host() {
      useRestoreWorkspaceTabsOnView({ workspaceId: WORKSPACE_A_ID })
      return null
    }
    mocks.storeState = {
      workspaces: {
        [WORKSPACE_A_ID]: stubRepo(WORKSPACE_A_ID, 'rta', { projectionState: 'stub', loadedAt: 1 }),
      },
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }
    mocks.restoreWorkspaceTabsOnView.mockResolvedValue({
      workspace: { workspaceId: 'repo-a', workspaceRuntimeId: 'rta' },
      snapshot: null,
    })

    renderInJsdom(<Host />)

    await waitFor(() => expect(mocks.restoreWorkspaceTabsOnView).toHaveBeenCalledTimes(1))
    expect(mocks.restoreWorkspaceTabsOnView).toHaveBeenCalledWith('test-client-id', WORKSPACE_A_ID, 'rta')
    await waitFor(() => expect(mocks.promoteRestoredWorkspace).toHaveBeenCalledTimes(1))
  })

  test('on success, hydrates the store with the returned repo and snapshot', async () => {
    function Host() {
      useRestoreWorkspaceTabsOnView({ workspaceId: WORKSPACE_A_ID })
      return null
    }
    mocks.storeState = {
      workspaces: { [WORKSPACE_A_ID]: stubRepo(WORKSPACE_A_ID, 'rta') },
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }
    mocks.restoreWorkspaceTabsOnView.mockResolvedValue({
      workspace: { workspaceId: '/r/a', workspaceRuntimeId: 'rta' },
      snapshot: { tabs: [{ key: 'status' }] },
    })

    renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.restoreWorkspaceTabsOnView).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.promoteRestoredWorkspace).toHaveBeenCalledTimes(1))
    expect(mocks.promoteRestoredWorkspace).toHaveBeenCalledWith({
      workspace: { workspaceId: '/r/a', workspaceRuntimeId: 'rta' },
      snapshot: { tabs: [{ key: 'status' }] },
    })
  })

  test('on success with null snapshot, hydrates with empty workspacePaneTabs', async () => {
    function Host() {
      useRestoreWorkspaceTabsOnView({ workspaceId: WORKSPACE_A_ID })
      return null
    }
    mocks.storeState = {
      workspaces: { [WORKSPACE_A_ID]: stubRepo(WORKSPACE_A_ID, 'rta') },
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }
    mocks.restoreWorkspaceTabsOnView.mockResolvedValue({
      workspace: { workspaceId: '/r/a', workspaceRuntimeId: 'rta' },
      snapshot: null,
    })

    renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.promoteRestoredWorkspace).toHaveBeenCalledTimes(1))
    expect(mocks.promoteRestoredWorkspace).toHaveBeenCalledWith({
      workspace: { workspaceId: '/r/a', workspaceRuntimeId: 'rta' },
      snapshot: null,
    })
  })

  test('does not apply a lazy restore response after the repo closes', async () => {
    let resolveFetch: ((value: unknown) => void) | null = null
    mocks.restoreWorkspaceTabsOnView.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    mocks.storeState = {
      workspaces: { [WORKSPACE_A_ID]: stubRepo(WORKSPACE_A_ID, 'rta') },
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }

    function Host() {
      useRestoreWorkspaceTabsOnView({ workspaceId: WORKSPACE_A_ID })
      return null
    }

    renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.restoreWorkspaceTabsOnView).toHaveBeenCalledTimes(1))

    mocks.storeState = {
      workspaces: {},
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }
    await act(async () => {
      resolveFetch?.({ workspace: { workspaceId: WORKSPACE_A_ID, workspaceRuntimeId: 'rta' }, snapshot: null })
      await Promise.resolve()
    })

    expect(mocks.promoteRestoredWorkspace).toHaveBeenCalledTimes(1)
  })

  test('on failure, exposes a stable view-local failure and does not hydrate', async () => {
    function Host() {
      const restore = useRestoreWorkspaceTabsOnView({ workspaceId: WORKSPACE_A_ID })
      return <div>{restore.state.phase === 'failed' ? restore.state.message : restore.state.phase}</div>
    }
    mocks.storeState = {
      workspaces: { [WORKSPACE_A_ID]: stubRepo(WORKSPACE_A_ID, 'rta') },
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }
    mocks.restoreWorkspaceTabsOnView.mockRejectedValue(new Error('disk gone'))

    const host = renderInJsdom(<Host />)
    await waitFor(() => expect(host.container.textContent).toBe('disk gone'))
    expect(mocks.promoteRestoredWorkspace).not.toHaveBeenCalled()
  })

  test('does not expose a previous repo failure after switching targets', async () => {
    mocks.storeState = {
      workspaces: {
        [WORKSPACE_A_ID]: stubRepo(WORKSPACE_A_ID, 'rta'),
        [WORKSPACE_B_ID]: stubRepo(WORKSPACE_B_ID, 'rtb'),
      },
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }
    mocks.restoreWorkspaceTabsOnView
      .mockRejectedValueOnce(new Error('repo-a failed'))
      .mockImplementation(() => new Promise(() => {}))

    function Host({ repoId }: { repoId: WorkspaceId }) {
      const restore = useRestoreWorkspaceTabsOnView({ workspaceId: repoId })
      return <div>{restore.state.phase === 'failed' ? restore.state.message : restore.state.phase}</div>
    }

    const host = renderInJsdom(<Host repoId={WORKSPACE_A_ID} />)
    await waitFor(() => expect(host.container.textContent).toBe('repo-a failed'))

    host.rerender(<Host repoId={WORKSPACE_B_ID} />)

    expect(host.container.textContent).not.toBe('repo-a failed')
    await waitFor(() => expect(mocks.restoreWorkspaceTabsOnView).toHaveBeenCalledTimes(2))
  })

  test('does not expose a previous failure after the workspace runtime changes', async () => {
    mocks.storeState = {
      workspaces: { [WORKSPACE_A_ID]: stubRepo(WORKSPACE_A_ID, 'runtime-old') },
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }
    mocks.restoreWorkspaceTabsOnView
      .mockRejectedValueOnce(new Error('old runtime failed'))
      .mockImplementation(() => new Promise(() => {}))

    function Host() {
      const restore = useRestoreWorkspaceTabsOnView({ workspaceId: WORKSPACE_A_ID })
      return <div>{restore.state.phase === 'failed' ? restore.state.message : restore.state.phase}</div>
    }

    const host = renderInJsdom(<Host />)
    await waitFor(() => expect(host.container.textContent).toBe('old runtime failed'))
    mocks.storeState = {
      workspaces: { [WORKSPACE_A_ID]: stubRepo(WORKSPACE_A_ID, 'runtime-new') },
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }

    host.rerender(<Host />)

    expect(host.container.textContent).not.toBe('old runtime failed')
    await waitFor(() => expect(mocks.restoreWorkspaceTabsOnView).toHaveBeenCalledTimes(2))
  })

  test('allows an explicit retry after a failure', async () => {
    function Host() {
      const restore = useRestoreWorkspaceTabsOnView({ workspaceId: RETRY_WORKSPACE_ID })
      return (
        <button onClick={restore.retry}>{restore.state.phase === 'failed' ? restore.state.message : 'retry'}</button>
      )
    }
    mocks.storeState = {
      workspaces: { [RETRY_WORKSPACE_ID]: stubRepo(RETRY_WORKSPACE_ID, 'rtr') },
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }
    mocks.restoreWorkspaceTabsOnView
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        workspace: { workspaceId: RETRY_WORKSPACE_ID, workspaceRuntimeId: 'rtr' },
        snapshot: null,
      })

    const host = renderInJsdom(<Host />)
    await waitFor(() => expect(host.container.textContent).toBe('boom'))
    await waitFor(() => expect(mocks.restoreWorkspaceTabsOnView).toHaveBeenCalledTimes(1))
    host.container.querySelector('button')?.click()
    await waitFor(() => expect(mocks.restoreWorkspaceTabsOnView).toHaveBeenCalledTimes(2))
    host.unmount()
  })

  test('concurrent mounts dedupe via the in-flight Map', async () => {
    let resolveFetch: ((value: unknown) => void) | null = null
    mocks.restoreWorkspaceTabsOnView.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    mocks.storeState = {
      workspaces: { [DEDUPE_WORKSPACE_ID]: stubRepo(DEDUPE_WORKSPACE_ID, 'rtd') },
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }

    function Host() {
      useRestoreWorkspaceTabsOnView({ workspaceId: DEDUPE_WORKSPACE_ID })
      return null
    }
    // Two separate mounts before the in-flight promise settles: the second
    // must hit the dedupe Map instead of firing a second network call.
    const hostA = renderInJsdom(<Host />)
    await waitFor(() => expect(mocks.restoreWorkspaceTabsOnView).toHaveBeenCalledTimes(1))
    const hostB = renderInJsdom(<Host />)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mocks.restoreWorkspaceTabsOnView).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFetch?.({ workspace: { workspaceId: '/r/d', workspaceRuntimeId: 'rtd' }, snapshot: null })
      await waitFor(() => expect(mocks.promoteRestoredWorkspace).toHaveBeenCalledTimes(2))
    })
    hostA.unmount()
    hostB.unmount()
  })
})
