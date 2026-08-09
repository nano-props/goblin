// @vitest-environment jsdom

import { waitFor } from '@testing-library/vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { defineComponent } from 'vue'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { flushMicrotasks } from '#/test-utils/microtasks.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { useRestoreWorkspaceTabsOnView } from '#/web/hooks/useRestoreWorkspaceTabsOnView.ts'
import type { ClientWorkspaceState } from '#/shared/api-types.ts'

const WORKSPACE_A_ID = workspaceIdForTest('goblin+file:///workspaces/a')
const WORKSPACE_B_ID = workspaceIdForTest('goblin+file:///workspaces/b')
const RETRY_WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspaces/retry')
const DEDUPE_WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspaces/dedupe')

interface RestoreStoreState {
  workspaces: Record<string, ReturnType<typeof stubRepo>>
  restoredClientWorkspaceBaseline?: ClientWorkspaceState | null
  promoteRestoredWorkspace: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => {
  const listeners = new Set<(state: RestoreStoreState) => void>()
  let storeState = {
    workspaces: {},
    restoredClientWorkspaceBaseline: null,
    promoteRestoredWorkspace: vi.fn(),
  } as RestoreStoreState
  return {
    restoreWorkspaceTabsOnView: vi.fn(),
    promoteRestoredWorkspace: vi.fn(),
    get storeState() {
      return storeState
    },
    set storeState(next) {
      storeState = next
      for (const listener of listeners) listener(storeState)
    },
    subscribe(listener: (state: RestoreStoreState) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
})

vi.mock('#/web/settings-actions.ts', () => ({
  restoreWorkspaceTabsOnView: mocks.restoreWorkspaceTabsOnView,
}))

vi.mock('#/web/client-page-id.ts', () => ({
  readClientPageId: () => 'test-client-id',
}))

vi.mock('#/web/stores/workspaces/store.ts', () => ({
  workspacesStore: {
    getState: () => mocks.storeState,
    subscribe: mocks.subscribe,
  },
}))

const RestoreHost = defineComponent<{ workspaceId: WorkspaceId | null; presentation?: 'none' | 'state' | 'retry' }>({
  name: 'RestoreWorkspaceTabsHost',
  props: ['workspaceId', 'presentation'],
  setup(props) {
    const restore = useRestoreWorkspaceTabsOnView({ workspaceId: () => props.workspaceId })
    return () => {
      if (props.presentation === 'retry') {
        return (
          <button onClick={restore.retry}>
            {restore.state.value.phase === 'failed' ? restore.state.value.message : 'retry'}
          </button>
        )
      }
      if (props.presentation === 'state') {
        return (
          <div>{restore.state.value.phase === 'failed' ? restore.state.value.message : restore.state.value.phase}</div>
        )
      }
      return null
    }
  },
})

function stubRepo(
  id: WorkspaceId,
  workspaceRuntimeId: string,
  options: { projectionState?: 'projected' | 'stub' } = {},
) {
  return {
    id,
    workspaceRuntimeId,
    session: {
      entry: { id },
      projectionState: options.projectionState ?? 'stub',
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
    renderInJsdom(<RestoreHost workspaceId={null} />)
    await waitFor(() => expect(mocks.restoreWorkspaceTabsOnView).not.toHaveBeenCalled())
  })

  test('does nothing when the repo is already client-owned', async () => {
    mocks.storeState = {
      workspaces: {
        [WORKSPACE_A_ID]: stubRepo(WORKSPACE_A_ID, 'rta', { projectionState: 'projected' }),
      },
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }
    renderInJsdom(<RestoreHost workspaceId={WORKSPACE_A_ID} />)
    await waitFor(() => expect(mocks.restoreWorkspaceTabsOnView).not.toHaveBeenCalled())
  })

  test('restores a workspace stub', async () => {
    mocks.storeState = {
      workspaces: {
        [WORKSPACE_A_ID]: stubRepo(WORKSPACE_A_ID, 'rta', { projectionState: 'stub' }),
      },
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }
    mocks.restoreWorkspaceTabsOnView.mockResolvedValue({
      workspace: { workspaceId: 'repo-a', workspaceRuntimeId: 'rta' },
      snapshot: null,
    })

    renderInJsdom(<RestoreHost workspaceId={WORKSPACE_A_ID} />)

    await waitFor(() => expect(mocks.restoreWorkspaceTabsOnView).toHaveBeenCalledTimes(1))
    expect(mocks.restoreWorkspaceTabsOnView).toHaveBeenCalledWith('test-client-id', WORKSPACE_A_ID, 'rta')
    await waitFor(() => expect(mocks.promoteRestoredWorkspace).toHaveBeenCalledTimes(1))
  })

  test('on success, hydrates the store with the returned repo and snapshot', async () => {
    mocks.storeState = {
      workspaces: { [WORKSPACE_A_ID]: stubRepo(WORKSPACE_A_ID, 'rta') },
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }
    mocks.restoreWorkspaceTabsOnView.mockResolvedValue({
      workspace: { workspaceId: '/r/a', workspaceRuntimeId: 'rta' },
      snapshot: { tabs: [{ key: 'status' }] },
    })

    renderInJsdom(<RestoreHost workspaceId={WORKSPACE_A_ID} />)
    await waitFor(() => expect(mocks.restoreWorkspaceTabsOnView).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.promoteRestoredWorkspace).toHaveBeenCalledTimes(1))
    expect(mocks.promoteRestoredWorkspace).toHaveBeenCalledWith({
      workspace: { workspaceId: '/r/a', workspaceRuntimeId: 'rta' },
      snapshot: { tabs: [{ key: 'status' }] },
    })
  })

  test('on success with null snapshot, hydrates with empty workspacePaneTabs', async () => {
    mocks.storeState = {
      workspaces: { [WORKSPACE_A_ID]: stubRepo(WORKSPACE_A_ID, 'rta') },
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }
    mocks.restoreWorkspaceTabsOnView.mockResolvedValue({
      workspace: { workspaceId: '/r/a', workspaceRuntimeId: 'rta' },
      snapshot: null,
    })

    renderInJsdom(<RestoreHost workspaceId={WORKSPACE_A_ID} />)
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

    renderInJsdom(<RestoreHost workspaceId={WORKSPACE_A_ID} />)
    await waitFor(() => expect(mocks.restoreWorkspaceTabsOnView).toHaveBeenCalledTimes(1))

    mocks.storeState = {
      workspaces: {},
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }
    await flushTestUpdates(async () => {
      resolveFetch?.({ workspace: { workspaceId: WORKSPACE_A_ID, workspaceRuntimeId: 'rta' }, snapshot: null })
      await Promise.resolve()
    })

    expect(mocks.promoteRestoredWorkspace).not.toHaveBeenCalled()
  })

  test('on failure, exposes a stable view-local failure and does not hydrate', async () => {
    mocks.storeState = {
      workspaces: { [WORKSPACE_A_ID]: stubRepo(WORKSPACE_A_ID, 'rta') },
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }
    mocks.restoreWorkspaceTabsOnView.mockRejectedValue(new Error('disk gone'))

    const host = renderInJsdom(<RestoreHost workspaceId={WORKSPACE_A_ID} presentation="state" />)
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

    const host = renderInJsdom(<RestoreHost workspaceId={WORKSPACE_A_ID} presentation="state" />)
    await waitFor(() => expect(host.container.textContent).toBe('repo-a failed'))

    await host.rerender(<RestoreHost workspaceId={WORKSPACE_B_ID} presentation="state" />)

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

    const host = renderInJsdom(<RestoreHost workspaceId={WORKSPACE_A_ID} presentation="state" />)
    await waitFor(() => expect(host.container.textContent).toBe('old runtime failed'))
    mocks.storeState = {
      workspaces: { [WORKSPACE_A_ID]: stubRepo(WORKSPACE_A_ID, 'runtime-new') },
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }

    await host.rerender(<RestoreHost workspaceId={WORKSPACE_A_ID} presentation="state" />)

    expect(host.container.textContent).not.toBe('old runtime failed')
    await waitFor(() => expect(mocks.restoreWorkspaceTabsOnView).toHaveBeenCalledTimes(2))
  })

  test('allows an explicit retry after a failure', async () => {
    mocks.storeState = {
      workspaces: { [RETRY_WORKSPACE_ID]: stubRepo(RETRY_WORKSPACE_ID, 'rtr') },
      promoteRestoredWorkspace: mocks.promoteRestoredWorkspace,
    }
    mocks.restoreWorkspaceTabsOnView.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({
      workspace: { workspaceId: RETRY_WORKSPACE_ID, workspaceRuntimeId: 'rtr' },
      snapshot: null,
    })

    const host = renderInJsdom(<RestoreHost workspaceId={RETRY_WORKSPACE_ID} presentation="retry" />)
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

    // Two separate mounts before the in-flight promise settles: the second
    // must hit the dedupe Map instead of firing a second network call.
    const hostA = renderInJsdom(<RestoreHost workspaceId={DEDUPE_WORKSPACE_ID} />)
    await waitFor(() => expect(mocks.restoreWorkspaceTabsOnView).toHaveBeenCalledTimes(1))
    const hostB = renderInJsdom(<RestoreHost workspaceId={DEDUPE_WORKSPACE_ID} />)
    await flushMicrotasks()
    expect(mocks.restoreWorkspaceTabsOnView).toHaveBeenCalledTimes(1)

    await flushTestUpdates(async () => {
      resolveFetch?.({ workspace: { workspaceId: '/r/d', workspaceRuntimeId: 'rtd' }, snapshot: null })
      await waitFor(() => expect(mocks.promoteRestoredWorkspace).toHaveBeenCalledTimes(2))
    })
    hostA.unmount()
    hostB.unmount()
  })
})
