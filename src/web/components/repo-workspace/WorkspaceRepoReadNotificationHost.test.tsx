// @vitest-environment jsdom

import { screen } from '@testing-library/vue'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushTestUpdates, renderInJsdom } from '#/test-utils/render.tsx'
import { REPO_MEMBERSHIP_READ_CONFLICT_KEY } from '#/shared/repo-membership-read.ts'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { appQueryClient } from '#/web/app/query-client.ts'
import { WorkspaceRepoReadNotificationHost } from '#/web/components/repo-workspace/WorkspaceRepoReadNotificationHost.tsx'
import { repoSnapshotQueryKey, repoWorktreeStatusQueryKey } from '#/web/repos/query-keys.ts'
import { installGoblinTestBridge } from '#/web/test-utils/bridge.ts'
import { createRepoBranch, resetWorkspacesStore, seedRepoQueryDataForTest } from '#/web/test-utils/repo-store.ts'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/example-workspace')
const WORKSPACE_RUNTIME_ID = 'workspace-runtime'

describe('WorkspaceRepoReadNotificationHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appQueryClient.clear()
    resetWorkspacesStore()
  })

  test('projects concurrent stale reads as one persistent right-top notice', async () => {
    seedReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    const readSnapshot = vi.fn(async () => {
      throw new Error('snapshot failed')
    })
    const readStatus = vi.fn(async () => {
      throw new Error('status failed')
    })
    installGoblinTestBridge({
      'repo.snapshot': readSnapshot,
      'repo.worktreeStatus': readStatus,
    })
    renderNotification(WORKSPACE_RUNTIME_ID)
    setQueryError(
      repoSnapshotQueryKey(WORKSPACE_ID, WORKSPACE_RUNTIME_ID),
      new Error('error.workspace-runtime-stale'),
      1,
    )
    setQueryError(
      repoWorktreeStatusQueryKey(WORKSPACE_ID, WORKSPACE_RUNTIME_ID),
      new Error('error.workspace-runtime-stale'),
      1,
    )

    const host = await screen.findByTestId('workspace-repo-read-notification')
    expect(screen.getAllByTestId('repo-read-notification')).toHaveLength(1)
    expect(host.getAttribute('role')).toBe('status')
    expect(host.style.top).toBe(`${TITLE_BAR_HEIGHT_PX + 12}px`)
    expect(host.textContent).toContain('status.stale-title')

    await flushTestUpdates(() => screen.getByRole<HTMLButtonElement>('button', { name: 'error.try-again' }).click())
    await vi.waitFor(() => {
      expect(readSnapshot).toHaveBeenCalledOnce()
      expect(readStatus).toHaveBeenCalledOnce()
    })
  })

  test('waits for a workspace snapshot before surfacing dependent read failures', async () => {
    const readSnapshot = vi.fn(async () => {
      throw new Error('snapshot failed')
    })
    const readStatus = vi.fn(async () => {
      throw new Error('status failed')
    })
    installGoblinTestBridge({
      'repo.snapshot': readSnapshot,
      'repo.worktreeStatus': readStatus,
    })

    renderNotification(WORKSPACE_RUNTIME_ID)

    await vi.waitFor(() => {
      expect(readSnapshot).toHaveBeenCalledOnce()
      expect(readStatus).toHaveBeenCalledOnce()
    })
    expect(screen.queryByTestId('workspace-repo-read-notification')).toBeNull()
  })

  test('surfaces an unavailable status read after the workspace snapshot is ready', async () => {
    seedReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    installGoblinTestBridge({})
    renderNotification(WORKSPACE_RUNTIME_ID)
    setQueryError(repoWorktreeStatusQueryKey(WORKSPACE_ID, WORKSPACE_RUNTIME_ID), new Error('status failed'), 1, false)

    const host = await screen.findByTestId('workspace-repo-read-notification')
    expect(host.getAttribute('role')).toBe('alert')
    expect(host.textContent).toContain('error.failed-read-repo')
    expect(screen.getByTestId('repo-read-notification').getAttribute('data-kind')).toBe('unavailable')
  })

  test('presents membership changes as a neutral transition', async () => {
    seedReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    installGoblinTestBridge({})
    renderNotification(WORKSPACE_RUNTIME_ID)
    setQueryError(
      repoWorktreeStatusQueryKey(WORKSPACE_ID, WORKSPACE_RUNTIME_ID),
      new Error(REPO_MEMBERSHIP_READ_CONFLICT_KEY),
      1,
    )

    const host = await screen.findByTestId('workspace-repo-read-notification')
    expect(host.getAttribute('role')).toBe('status')
    expect(host.textContent).toContain(REPO_MEMBERSHIP_READ_CONFLICT_KEY)
    expect(screen.getByTestId('repo-read-notification').getAttribute('data-kind')).toBe('membership-changing')
  })

  test('dismisses only the current failure condition', async () => {
    seedReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    installGoblinTestBridge({})
    renderNotification(WORKSPACE_RUNTIME_ID)
    const queryKey = repoSnapshotQueryKey(WORKSPACE_ID, WORKSPACE_RUNTIME_ID)
    setQueryError(queryKey, new Error('snapshot failed'), 1)
    await screen.findByTestId('workspace-repo-read-notification')

    await flushTestUpdates(() =>
      screen.getByRole<HTMLButtonElement>('button', { name: 'status.dismiss-notification' }).click(),
    )
    expect(screen.queryByTestId('workspace-repo-read-notification')).toBeNull()

    setQueryError(queryKey, new Error('snapshot failed'), 2)
    expect(await screen.findByTestId('workspace-repo-read-notification')).not.toBeNull()
  })

  test('removes the projection when authoritative reads recover or the runtime changes', async () => {
    const nextRuntimeId = 'next-workspace-runtime'
    seedReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    seedReadyRepoQueries(nextRuntimeId)
    installGoblinTestBridge({})
    const view = renderNotification(WORKSPACE_RUNTIME_ID)
    setQueryError(repoSnapshotQueryKey(WORKSPACE_ID, WORKSPACE_RUNTIME_ID), new Error('snapshot failed'), 1)
    await screen.findByTestId('workspace-repo-read-notification')

    seedReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    await vi.waitFor(() => expect(screen.queryByTestId('workspace-repo-read-notification')).toBeNull())

    setQueryError(repoSnapshotQueryKey(WORKSPACE_ID, WORKSPACE_RUNTIME_ID), new Error('snapshot failed'), 2)
    await screen.findByTestId('workspace-repo-read-notification')
    await view.rerender(notificationTree(nextRuntimeId))
    expect(screen.queryByTestId('workspace-repo-read-notification')).toBeNull()
  })
})

function notificationTree(workspaceRuntimeId: string) {
  return (
    <VueQueryClientScope client={appQueryClient}>
      <WorkspaceRepoReadNotificationHost
        key={workspaceRuntimeId}
        workspaceId={WORKSPACE_ID}
        workspaceRuntimeId={workspaceRuntimeId}
      />
    </VueQueryClientScope>
  )
}

function renderNotification(workspaceRuntimeId: string) {
  return renderInJsdom(notificationTree(workspaceRuntimeId))
}

function snapshotQuery(workspaceRuntimeId: string) {
  const query = appQueryClient.getQueryCache().find({
    queryKey: repoSnapshotQueryKey(WORKSPACE_ID, workspaceRuntimeId),
    exact: true,
  })
  if (!query) throw new Error('missing snapshot query fixture')
  return query
}

function setQueryError(queryKey: readonly unknown[], error: Error, errorUpdatedAt: number, retainData = true): void {
  const query = appQueryClient.getQueryCache().find({ queryKey, exact: true })
  if (!query) throw new Error('missing repo query fixture')
  query.setState({
    ...query.state,
    data: retainData ? query.state.data : undefined,
    dataUpdatedAt: retainData ? query.state.dataUpdatedAt : 0,
    status: 'error',
    error,
    errorUpdatedAt,
  })
}

function seedReadyRepoQueries(workspaceRuntimeId: string): void {
  seedRepoQueryDataForTest(
    { id: WORKSPACE_ID, workspaceRuntimeId },
    {
      branches: [createRepoBranch('main')],
      currentBranch: 'main',
      status: [],
    },
  )
}
