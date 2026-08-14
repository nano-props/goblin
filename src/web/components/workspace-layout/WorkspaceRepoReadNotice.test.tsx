// @vitest-environment jsdom

import { screen } from '@testing-library/vue'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushTestUpdates, renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { appQueryClient } from '#/web/app/query-client.ts'
import { WorkspaceRepoReadNotice } from '#/web/components/workspace-layout/WorkspaceRepoReadNotice.tsx'
import { repoSnapshotQueryKey, repoWorktreeStatusQueryKey } from '#/web/repos/query-keys.ts'
import { installGoblinTestBridge } from '#/web/test-utils/bridge.ts'
import { createRepoBranch, resetWorkspacesStore, seedRepoQueryDataForTest } from '#/web/test-utils/repo-store.ts'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/example-workspace')
const WORKSPACE_RUNTIME_ID = 'workspace-runtime'

describe('WorkspaceRepoReadNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appQueryClient.clear()
    resetWorkspacesStore()
  })

  test('combines stale workspace reads into one persistent retry', async () => {
    seedRepoQueryDataForTest(
      { id: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      {
        branches: [createRepoBranch('main')],
        currentBranch: 'main',
        status: [],
      },
    )
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
    await Promise.all([
      appQueryClient.invalidateQueries({
        queryKey: repoSnapshotQueryKey(WORKSPACE_ID, WORKSPACE_RUNTIME_ID),
        exact: true,
        refetchType: 'none',
      }),
      appQueryClient.invalidateQueries({
        queryKey: repoWorktreeStatusQueryKey(WORKSPACE_ID, WORKSPACE_RUNTIME_ID),
        exact: true,
        refetchType: 'none',
      }),
    ])

    renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <WorkspaceRepoReadNotice workspaceId={WORKSPACE_ID} workspaceRuntimeId={WORKSPACE_RUNTIME_ID} />
      </VueQueryClientScope>,
    )

    expect(await screen.findAllByText('status.stale-title')).toHaveLength(1)
    await flushTestUpdates(() => screen.getByRole<HTMLElement>('button', { name: 'error.try-again' }).click())
    await vi.waitFor(() => {
      expect(readSnapshot).toHaveBeenCalledTimes(2)
      expect(readStatus).toHaveBeenCalledTimes(2)
    })
  })

  test('leaves initial dependent read failures to the local blocking surface', async () => {
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

    renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <WorkspaceRepoReadNotice workspaceId={WORKSPACE_ID} workspaceRuntimeId={WORKSPACE_RUNTIME_ID} />
      </VueQueryClientScope>,
    )

    await vi.waitFor(() => {
      expect(readSnapshot).toHaveBeenCalledOnce()
      expect(readStatus).toHaveBeenCalledOnce()
    })
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
