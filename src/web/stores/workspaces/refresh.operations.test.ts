import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getRepoSnapshotQueryData, getRepoWorktreeStatusQueryData } from '#/web/repo-query-cache.ts'
import { runManualWorkspaceRefresh } from '#/web/stores/workspaces/workspace-refresh-command.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { seedRepoWithReadModelForTest } from '#/web/test-utils/repo-store.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoPullRequestsQueryPrefix } from '#/web/repo-query-keys.ts'
import {
  REPO_ID,
  branch,
  ipcHandlers,
  refreshStoreAccess,
  repoSnapshotResponse,
  resetRefreshTest,
  seedRepo,
} from '#/web/stores/workspaces/refresh-test-utils.ts'

beforeEach(resetRefreshTest)

describe('manual workspace refresh', () => {
  test('skips fetch for a local-only repository and refreshes snapshot and status independently', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [branch('main')],
      remote: { hasRemotes: false },
    })
    const fetch = vi.fn(async () => ({ ok: true as const, message: 'ok' }))
    const snapshot = vi.fn(async () =>
      repoSnapshotResponse({ branches: [branch('main'), branch('feature/a')], current: 'main' }),
    )
    const status = vi.fn(({ workspaceRuntimeId }: { workspaceRuntimeId: string }) => ({
      workspaceRuntimeId,
      status: [{ path: '/tmp/repository', branch: 'main', isMain: true, entries: [] }],
      loadedAt: Date.now(),
    }))
    ipcHandlers['repo.fetch'] = fetch
    ipcHandlers['repo.snapshot'] = snapshot
    ipcHandlers['repo.worktreeStatus'] = status
    const refetchPullRequests = vi.spyOn(primaryWindowQueryClient, 'refetchQueries')

    await expect(
      runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId: repo.workspaceRuntimeId }),
    ).resolves.toEqual({ ok: true })

    expect(fetch).not.toHaveBeenCalled()
    expect(snapshot).toHaveBeenCalledOnce()
    expect(status).toHaveBeenCalledOnce()
    expect(refetchPullRequests).toHaveBeenCalledWith({
      queryKey: repoPullRequestsQueryPrefix(REPO_ID, repo.workspaceRuntimeId),
      type: 'active',
    })
    expect(getRepoSnapshotQueryData(REPO_ID, repo.workspaceRuntimeId)?.branches).toHaveLength(2)
    expect(getRepoWorktreeStatusQueryData(REPO_ID, repo.workspaceRuntimeId)?.status).toHaveLength(1)
  })

  test('does not wait for the active pull-request refresh', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [branch('main')],
      remote: { hasRemotes: false },
    })
    const pending = new Promise<void>(() => {})
    vi.spyOn(primaryWindowQueryClient, 'refetchQueries').mockReturnValue(pending)
    ipcHandlers['repo.snapshot'] = vi.fn(async () =>
      repoSnapshotResponse({ branches: [branch('main')], current: 'main' }),
    )
    ipcHandlers['repo.worktreeStatus'] = vi.fn(({ workspaceRuntimeId }: { workspaceRuntimeId: string }) => ({
      workspaceRuntimeId,
      status: [],
      loadedAt: Date.now(),
    }))

    await expect(
      runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId: repo.workspaceRuntimeId }),
    ).resolves.toEqual({ ok: true })
  })

  test('fetches a repository with remotes before refreshing the read models', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    const order: string[] = []
    ipcHandlers['repo.fetch'] = async () => {
      order.push('fetch')
      return { ok: true, message: 'ok' }
    }
    ipcHandlers['repo.snapshot'] = async () => {
      order.push('snapshot')
      return repoSnapshotResponse({ branches: [branch('main')], current: 'main' })
    }
    ipcHandlers['repo.worktreeStatus'] = ({ workspaceRuntimeId: runtimeId }: { workspaceRuntimeId: string }) => {
      order.push('status')
      return { workspaceRuntimeId: runtimeId, status: [], loadedAt: Date.now() }
    }

    await runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    expect(order[0]).toBe('fetch')
    expect(new Set(order.slice(1))).toEqual(new Set(['snapshot', 'status']))
  })

  test('coalesces concurrent refresh commands for the same runtime', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    let resolveFetch!: (result: { ok: true; message: string }) => void
    const fetch = vi.fn(
      () =>
        new Promise<{ ok: true; message: string }>((resolve) => {
          resolveFetch = resolve
        }),
    )
    ipcHandlers['repo.fetch'] = fetch
    ipcHandlers['repo.snapshot'] = () => repoSnapshotResponse({ branches: [branch('main')], current: 'main' })

    const first = runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })
    const second = runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    resolveFetch({ ok: true, message: 'ok' })

    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }])
    expect(fetch).toHaveBeenCalledOnce()
  })

  test('does not apply completion effects to a reopened runtime', async () => {
    const firstRuntimeId = seedRepo([branch('main')], 'repo-runtime-first')
    let resolveFetch!: (result: { ok: true; message: string }) => void
    ipcHandlers['repo.fetch'] = () =>
      new Promise((resolve) => {
        resolveFetch = resolve
      })
    const refresh = runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId: firstRuntimeId })
    await vi.waitFor(() => expect(resolveFetch).toEqual(expect.any(Function)))

    seedRepo([branch('reopened')], 'repo-runtime-second')
    resolveFetch({ ok: true, message: 'ok' })
    await refresh

    expect(useWorkspacesStore.getState().workspaces[REPO_ID]?.workspaceRuntimeId).toBe('repo-runtime-second')
    expect(getRepoSnapshotQueryData(REPO_ID, 'repo-runtime-second')?.current).toBe('reopened')
  })
})
