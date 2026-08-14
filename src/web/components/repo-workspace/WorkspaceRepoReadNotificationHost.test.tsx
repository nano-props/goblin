// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushTestUpdates, renderInJsdom } from '#/test-utils/render.tsx'
import { REPO_MEMBERSHIP_READ_CONFLICT_KEY } from '#/shared/repo-membership-read.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { appQueryClient } from '#/web/app/query-client.ts'
import { RepoReadNotificationToast } from '#/web/components/repo-workspace/RepoReadNotificationToast.tsx'
import { WorkspaceRepoReadNotificationHost } from '#/web/components/repo-workspace/WorkspaceRepoReadNotificationHost.tsx'
import { repoSnapshotQueryKey, repoWorktreeStatusQueryKey } from '#/web/repos/query-keys.ts'
import { installGoblinTestBridge } from '#/web/test-utils/bridge.ts'
import { createRepoBranch, resetWorkspacesStore, seedRepoQueryDataForTest } from '#/web/test-utils/repo-store.ts'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'

const notificationMocks = vi.hoisted(() => ({
  custom: vi.fn(),
  dismiss: vi.fn(),
}))

vi.mock('vue-sonner', () => ({ toast: notificationMocks }))

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/example-workspace')
const WORKSPACE_RUNTIME_ID = 'workspace-runtime'

describe('WorkspaceRepoReadNotificationHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    let nextToastId = 0
    notificationMocks.custom.mockImplementation(
      (_component, options) => options?.id ?? `repo-read-toast-${++nextToastId}`,
    )
    appQueryClient.clear()
    resetWorkspacesStore()
  })

  test('combines stale workspace reads into one persistent top-right retry', async () => {
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
    await invalidateReadyRepoQueries(WORKSPACE_RUNTIME_ID)

    renderNotification(WORKSPACE_RUNTIME_ID)

    await vi.waitFor(() => expect(notificationMocks.custom).toHaveBeenCalled())
    const { component, options } = repoReadNotificationInvocation()
    expect(component).toBe(RepoReadNotificationToast)
    expect(options).toEqual(
      expect.objectContaining({
        position: 'top-right',
        duration: Number.POSITIVE_INFINITY,
        class: 'min-[601px]:w-[420px]',
      }),
    )
    expect(options.id).toBeUndefined()
    expect(options.componentProps).toEqual(
      expect.objectContaining({
        title: 'status.stale-title',
        retryLabel: 'error.try-again',
        dismissLabel: 'status.dismiss-notification',
        kind: 'stale',
      }),
    )

    options.componentProps.onRetry()
    await vi.waitFor(() => {
      expect(readSnapshot).toHaveBeenCalledTimes(2)
      expect(readStatus).toHaveBeenCalledTimes(2)
    })
  })

  test('waits for the workspace snapshot before presenting dependent read failures', async () => {
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
    expect(notificationMocks.custom).not.toHaveBeenCalled()
  })

  test('presents an unavailable status read after the workspace snapshot is ready', async () => {
    seedReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    const statusQuery = appQueryClient.getQueryCache().find({
      queryKey: repoWorktreeStatusQueryKey(WORKSPACE_ID, WORKSPACE_RUNTIME_ID),
      exact: true,
    })
    if (!statusQuery) throw new Error('missing status query fixture')
    statusQuery.setState({
      ...statusQuery.state,
      data: undefined,
      dataUpdatedAt: 0,
      status: 'error',
      error: new Error('status failed'),
    })
    const readStatus = vi.fn(async () => {
      throw new Error('status failed')
    })
    installGoblinTestBridge({ 'repo.worktreeStatus': readStatus })

    renderNotification(WORKSPACE_RUNTIME_ID)

    await vi.waitFor(() => expect(notificationMocks.custom).toHaveBeenCalled())
    const { options } = repoReadNotificationInvocation()
    expect(options.componentProps).toEqual(
      expect.objectContaining({
        title: 'error.failed-read-repo',
        kind: 'unavailable',
      }),
    )

    const readsBeforeRetry = readStatus.mock.calls.length
    options.componentProps.onRetry()
    await vi.waitFor(() => expect(readStatus).toHaveBeenCalledTimes(readsBeforeRetry + 1))
  })

  test('presents membership changes as a neutral transition', async () => {
    seedReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    const statusQuery = appQueryClient.getQueryCache().find({
      queryKey: repoWorktreeStatusQueryKey(WORKSPACE_ID, WORKSPACE_RUNTIME_ID),
      exact: true,
    })
    if (!statusQuery) throw new Error('missing status query fixture')
    statusQuery.setState({
      ...statusQuery.state,
      status: 'error',
      error: new Error(REPO_MEMBERSHIP_READ_CONFLICT_KEY),
    })
    installGoblinTestBridge({
      'repo.worktreeStatus': async () => {
        throw new Error(REPO_MEMBERSHIP_READ_CONFLICT_KEY)
      },
    })

    renderNotification(WORKSPACE_RUNTIME_ID)

    await vi.waitFor(() => expect(notificationMocks.custom).toHaveBeenCalled())
    const { options } = repoReadNotificationInvocation()
    expect(options.componentProps).toEqual(
      expect.objectContaining({
        kind: 'membership-changing',
        title: REPO_MEMBERSHIP_READ_CONFLICT_KEY,
        description: undefined,
      }),
    )
  })

  test('dismisses only the current failure', async () => {
    seedReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    installFailingRepoReads()
    await invalidateReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    renderNotification(WORKSPACE_RUNTIME_ID)

    await vi.waitFor(() => expect(notificationMocks.custom).toHaveBeenCalled())
    const customCallsBeforeDismiss = notificationMocks.custom.mock.calls.length
    const { options } = repoReadNotificationInvocation()
    notificationMocks.dismiss.mockClear()
    await flushTestUpdates(() => options.onDismiss())

    expect(notificationMocks.dismiss).not.toHaveBeenCalled()
    expect(notificationMocks.custom).toHaveBeenCalledTimes(customCallsBeforeDismiss)

    await appQueryClient.invalidateQueries({
      queryKey: repoSnapshotQueryKey(WORKSPACE_ID, WORKSPACE_RUNTIME_ID),
      exact: true,
      refetchType: 'active',
    })
    await vi.waitFor(() => expect(notificationMocks.custom.mock.calls.length).toBeGreaterThan(customCallsBeforeDismiss))
  })

  test('does not dismiss a Sonner id that the host never presented', async () => {
    seedReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    const view = renderNotification(WORKSPACE_RUNTIME_ID)

    await flushTestUpdates(() => {})
    view.unmount()

    expect(notificationMocks.custom).not.toHaveBeenCalled()
    expect(notificationMocks.dismiss).not.toHaveBeenCalled()
  })

  test('releases the presented Sonner handle with the host scope', async () => {
    seedReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    installFailingRepoReads()
    await invalidateReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    const view = renderNotification(WORKSPACE_RUNTIME_ID)

    await vi.waitFor(() => expect(notificationMocks.custom).toHaveBeenCalled())
    notificationMocks.dismiss.mockClear()
    view.unmount()

    expect(notificationMocks.dismiss).toHaveBeenCalledOnce()
    expect(notificationMocks.dismiss).toHaveBeenCalledWith('repo-read-toast-1')
  })

  test('closes the notification when authoritative reads recover', async () => {
    seedReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    installFailingRepoReads()
    await invalidateReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    renderNotification(WORKSPACE_RUNTIME_ID)

    await vi.waitFor(() => expect(notificationMocks.custom).toHaveBeenCalled())
    notificationMocks.dismiss.mockClear()
    seedReadyRepoQueries(WORKSPACE_RUNTIME_ID)

    await vi.waitFor(() => expect(notificationMocks.dismiss).toHaveBeenCalledWith('repo-read-toast-1'))
  })

  test('uses a new Sonner handle when a later failure follows recovery', async () => {
    seedReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    installFailingRepoReads()
    await invalidateReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    const view = renderNotification(WORKSPACE_RUNTIME_ID)

    await vi.waitFor(() => expect(notificationMocks.custom).toHaveBeenCalled())
    const firstCall = repoReadNotificationInvocation()
    expect(firstCall.result).toBe('repo-read-toast-1')

    seedReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    await vi.waitFor(() => expect(notificationMocks.dismiss).toHaveBeenCalledWith('repo-read-toast-1'))
    const callsBeforeNextFailure = notificationMocks.custom.mock.calls.length
    await appQueryClient.invalidateQueries({
      queryKey: repoSnapshotQueryKey(WORKSPACE_ID, WORKSPACE_RUNTIME_ID),
      exact: true,
      refetchType: 'active',
    })

    await vi.waitFor(() => expect(notificationMocks.custom.mock.calls.length).toBeGreaterThan(callsBeforeNextFailure))
    const nextCall = repoReadNotificationInvocation()
    expect(nextCall.options.id).toBeUndefined()
    expect(nextCall.result).toBe('repo-read-toast-2')

    notificationMocks.dismiss.mockClear()
    await flushTestUpdates(() => firstCall.options.onDismiss())
    expect(notificationMocks.dismiss).not.toHaveBeenCalled()

    view.unmount()
    expect(notificationMocks.dismiss).toHaveBeenCalledWith('repo-read-toast-2')
  })

  test('retires the previous runtime notification without projecting it into the next runtime', async () => {
    const nextRuntimeId = 'next-workspace-runtime'
    seedReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    seedReadyRepoQueries(nextRuntimeId)
    installFailingRepoReads()
    await invalidateReadyRepoQueries(WORKSPACE_RUNTIME_ID)
    const view = renderNotification(WORKSPACE_RUNTIME_ID)

    await vi.waitFor(() => expect(notificationMocks.custom).toHaveBeenCalled())
    notificationMocks.dismiss.mockClear()
    await view.rerender(
      <VueQueryClientScope client={appQueryClient}>
        <WorkspaceRepoReadNotificationHost workspaceId={WORKSPACE_ID} workspaceRuntimeId={nextRuntimeId} />
      </VueQueryClientScope>,
    )

    await vi.waitFor(() => expect(notificationMocks.dismiss).toHaveBeenCalledWith('repo-read-toast-1'))
    expect(notificationMocks.custom).toHaveBeenCalledOnce()

    await appQueryClient.invalidateQueries({
      queryKey: repoSnapshotQueryKey(WORKSPACE_ID, nextRuntimeId),
      exact: true,
      refetchType: 'active',
    })
    await vi.waitFor(() => expect(notificationMocks.custom).toHaveBeenCalledTimes(2))
    const nextRuntimeCall = repoReadNotificationInvocation()
    expect(nextRuntimeCall.options.id).toBeUndefined()
    expect(nextRuntimeCall.result).toBe('repo-read-toast-2')
  })
})

function renderNotification(workspaceRuntimeId: string) {
  return renderInJsdom(
    <VueQueryClientScope client={appQueryClient}>
      <WorkspaceRepoReadNotificationHost workspaceId={WORKSPACE_ID} workspaceRuntimeId={workspaceRuntimeId} />
    </VueQueryClientScope>,
  )
}

function installFailingRepoReads(): void {
  installGoblinTestBridge({
    'repo.snapshot': async () => {
      throw new Error('snapshot failed')
    },
    'repo.worktreeStatus': async () => {
      throw new Error('status failed')
    },
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

async function invalidateReadyRepoQueries(workspaceRuntimeId: string): Promise<void> {
  await Promise.all([
    appQueryClient.invalidateQueries({
      queryKey: repoSnapshotQueryKey(WORKSPACE_ID, workspaceRuntimeId),
      exact: true,
      refetchType: 'none',
    }),
    appQueryClient.invalidateQueries({
      queryKey: repoWorktreeStatusQueryKey(WORKSPACE_ID, workspaceRuntimeId),
      exact: true,
      refetchType: 'none',
    }),
  ])
}

function repoReadNotificationInvocation() {
  const call = notificationMocks.custom.mock.calls.at(-1)
  const result = notificationMocks.custom.mock.results.at(-1)?.value
  if (!call) throw new Error('missing repo read notification')
  const [component, options] = call
  if (!options) throw new Error('missing repo read notification options')
  return { component, options, result }
}
