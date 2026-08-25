// @vitest-environment jsdom

import { seedRepoWithReadModelForTest, resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useBackgroundFetch } from '#/web/hooks/useBackgroundFetch.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { RepoSnapshotResponse } from '#/shared/api-types.ts'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { appQueryClient } from '#/web/app/query-client.ts'
import { repoSnapshotQueryKey } from '#/web/repos/query-keys.ts'
import { resetServerCommandTransport } from '#/web/lib/server-command-transport.ts'

const mocks = vi.hoisted(() => ({
  setBackgroundSyncRepos: vi.fn(async (_targets: unknown, _signal?: AbortSignal) => {}),
}))

vi.mock('#/web/repos/client.ts', () => ({
  setBackgroundSyncRepos: mocks.setBackgroundSyncRepos,
}))

vi.mock('#/web/settings/runtime-fetch.ts', () => ({
  useFetchSettings: () => ({ value: { fetchIntervalSec: 30 } }),
}))

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace/background-sync')

describe('useBackgroundFetch request lifecycle', () => {
  beforeEach(() => {
    resetWorkspacesStore()
    mocks.setBackgroundSyncRepos.mockClear()
    seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      remote: { hasRemotes: true },
      workspaceRuntimeId: 'workspace-runtime-background-sync',
    })
  })

  test('cancels superseded and unmounted registration requests', async () => {
    const view = renderBackgroundFetchHost(WORKSPACE_ID, 'workspace-runtime-background-sync')
    await vi.waitFor(() => expect(mocks.setBackgroundSyncRepos).toHaveBeenCalledOnce())
    const firstSignal = mocks.setBackgroundSyncRepos.mock.calls[0]?.[1]
    const snapshot = appQueryClient.getQueryData<RepoSnapshotResponse>(
      repoSnapshotQueryKey(WORKSPACE_ID, 'workspace-runtime-background-sync'),
    )
    if (!snapshot) throw new Error('missing seeded repository snapshot')
    appQueryClient.setQueryData(repoSnapshotQueryKey(WORKSPACE_ID, 'workspace-runtime-next'), snapshot)

    await view.rerender(
      <VueQueryClientScope client={appQueryClient}>
        <BackgroundFetchHost workspaceId={WORKSPACE_ID} workspaceRuntimeId="workspace-runtime-next" />
      </VueQueryClientScope>,
    )
    await vi.waitFor(() => expect(mocks.setBackgroundSyncRepos).toHaveBeenCalledTimes(2))
    const secondSignal = mocks.setBackgroundSyncRepos.mock.calls[1]?.[1]

    expect(firstSignal?.aborted).toBe(true)
    expect(secondSignal?.aborted).toBe(false)
    view.unmount()
    expect(secondSignal?.aborted).toBe(true)
    await vi.waitFor(() => expect(mocks.setBackgroundSyncRepos).toHaveBeenLastCalledWith([], expect.any(AbortSignal)))
  })

  test('does not redeclare an unchanged target when its snapshot projection is refreshed', async () => {
    const view = renderBackgroundFetchHost(WORKSPACE_ID, 'workspace-runtime-background-sync')
    await vi.waitFor(() => expect(mocks.setBackgroundSyncRepos).toHaveBeenCalledOnce())
    const signal = mocks.setBackgroundSyncRepos.mock.calls[0]?.[1]
    const queryKey = repoSnapshotQueryKey(WORKSPACE_ID, 'workspace-runtime-background-sync')
    const snapshot = appQueryClient.getQueryData<RepoSnapshotResponse>(queryKey)
    if (!snapshot) throw new Error('missing seeded repository snapshot')

    appQueryClient.setQueryData(queryKey, { ...snapshot })
    await Promise.resolve()

    expect(mocks.setBackgroundSyncRepos).toHaveBeenCalledOnce()
    expect(signal?.aborted).toBe(false)
    view.unmount()
    expect(signal?.aborted).toBe(true)
  })

  test('redeclares the current target after command transport recovery', async () => {
    mocks.setBackgroundSyncRepos.mockImplementationOnce(waitForRegistrationAbort)
    const view = renderBackgroundFetchHost(WORKSPACE_ID, 'workspace-runtime-background-sync')
    await vi.waitFor(() => expect(mocks.setBackgroundSyncRepos).toHaveBeenCalledOnce())
    const staleSignal = mocks.setBackgroundSyncRepos.mock.calls[0]?.[1]

    resetServerCommandTransport()

    await vi.waitFor(() => expect(mocks.setBackgroundSyncRepos).toHaveBeenCalledTimes(2))
    expect(staleSignal?.aborted).toBe(true)
    expect(mocks.setBackgroundSyncRepos.mock.calls[1]?.[0]).toEqual([
      { workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'workspace-runtime-background-sync' },
    ])
    expect(mocks.setBackgroundSyncRepos.mock.calls[1]?.[1]?.aborted).toBe(false)
    view.unmount()
  })

  test('retains an empty declaration across transport recovery after owner disposal', async () => {
    const view = renderBackgroundFetchHost(WORKSPACE_ID, 'workspace-runtime-background-sync')
    await vi.waitFor(() => expect(mocks.setBackgroundSyncRepos).toHaveBeenCalledOnce())
    mocks.setBackgroundSyncRepos.mockImplementationOnce(waitForRegistrationAbort)

    view.unmount()
    await vi.waitFor(() => expect(mocks.setBackgroundSyncRepos).toHaveBeenCalledTimes(2))
    const staleClearSignal = mocks.setBackgroundSyncRepos.mock.calls[1]?.[1]
    expect(mocks.setBackgroundSyncRepos.mock.calls[1]?.[0]).toEqual([])

    resetServerCommandTransport()

    await vi.waitFor(() => expect(mocks.setBackgroundSyncRepos).toHaveBeenCalledTimes(3))
    expect(staleClearSignal?.aborted).toBe(true)
    expect(mocks.setBackgroundSyncRepos.mock.calls[2]?.[0]).toEqual([])
    expect(mocks.setBackgroundSyncRepos.mock.calls[2]?.[1]?.aborted).toBe(false)
  })

  test('does not let a replaced owner clear the current declaration', async () => {
    const firstView = renderBackgroundFetchHost(WORKSPACE_ID, 'workspace-runtime-background-sync')
    await vi.waitFor(() => expect(mocks.setBackgroundSyncRepos).toHaveBeenCalledOnce())
    const secondView = renderBackgroundFetchHost(WORKSPACE_ID, 'workspace-runtime-background-sync')
    await vi.waitFor(() => expect(mocks.setBackgroundSyncRepos).toHaveBeenCalledTimes(2))

    firstView.unmount()
    await Promise.resolve()
    expect(mocks.setBackgroundSyncRepos).toHaveBeenCalledTimes(2)

    secondView.unmount()
    await vi.waitFor(() => expect(mocks.setBackgroundSyncRepos).toHaveBeenCalledTimes(3))
    expect(mocks.setBackgroundSyncRepos).toHaveBeenLastCalledWith([], expect.any(AbortSignal))
  })

  test('does not declare a Git target when the required repo snapshot has no remotes', async () => {
    const snapshot = appQueryClient.getQueryData<RepoSnapshotResponse>(
      repoSnapshotQueryKey(WORKSPACE_ID, 'workspace-runtime-background-sync'),
    )
    if (!snapshot) throw new Error('missing seeded repository snapshot')
    appQueryClient.setQueryData(repoSnapshotQueryKey(WORKSPACE_ID, 'workspace-runtime-background-sync'), {
      snapshot: {
        ...snapshot.snapshot,
        remote: { ...snapshot.snapshot.remote, hasRemotes: false },
      },
    })

    const view = renderBackgroundFetchHost(WORKSPACE_ID, 'workspace-runtime-background-sync')
    await Promise.resolve()
    expect(mocks.setBackgroundSyncRepos).not.toHaveBeenCalled()
    view.unmount()
  })
})

const BackgroundFetchHost = defineComponent<{ workspaceId: WorkspaceId; workspaceRuntimeId: string }>({
  name: 'BackgroundFetchTestHost',
  props: ['workspaceId', 'workspaceRuntimeId'],
  setup(props) {
    useBackgroundFetch({
      workspaceId: () => props.workspaceId,
      workspaceRuntimeId: () => props.workspaceRuntimeId,
    })
    return () => null
  },
})

function renderBackgroundFetchHost(workspaceId: WorkspaceId, workspaceRuntimeId: string) {
  return renderInJsdom(
    <VueQueryClientScope client={appQueryClient}>
      <BackgroundFetchHost workspaceId={workspaceId} workspaceRuntimeId={workspaceRuntimeId} />
    </VueQueryClientScope>,
  )
}

function waitForRegistrationAbort(_targets: unknown, signal?: AbortSignal): Promise<void> {
  if (!signal) throw new Error('background sync registration signal is required')
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}
