import { CancelledError } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import { emptyWorkspace, replaceWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { refreshStatusLog, terminalLog } from '#/web/logger.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { requestRepoProjectionReadModelRefresh } from '#/web/stores/workspaces/refresh.ts'
import { runManualWorkspaceRefresh } from '#/web/stores/workspaces/workspace-refresh-command.ts'
import {
  branch,
  REPO_ID,
  resetRefreshTest,
  ipcHandlers,
  seedRepo,
  repoProjection,
  refreshStoreAccess,
  updateRepoForTest,
  repoBranchNames,
  repoCurrentBranch,
  cachedRepoProjection,
  cachedRepoStatus,
  createWorktreeAction,
} from '#/web/stores/workspaces/refresh-test-utils.ts'
import { seedRepoReadModelQueryData, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { canStartRemoteFetch } from '#/web/stores/workspaces/sync-state.ts'
import {
  preferredWorkspacePaneTabForTarget,
  preferredWorkspacePaneTabByTargetRecordWith,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoDataQueryKey, repoProjectionQueryKey, repoWorktreeStatusQueryKey } from '#/web/repo-query-keys.ts'
import {
  getRepoWorktreeStatusQueryData,
  setRepoProjectionQueryData,
  setRepoWorktreeStatusQueryData,
} from '#/web/repo-query-cache.ts'
import { repoProjectionQueryOptions, repoWorktreeStatusQueryOptions } from '#/web/repo-query-options.ts'
import { invalidateRepoSnapshotQueries } from '#/web/repo-query-runtime.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import type { GitWorkspaceRuntimeProjection } from '#/shared/api-types.ts'
import type { WorkspaceRefreshResult } from '#/shared/workspace-runtime.ts'
import type { WorktreeStatus } from '#/web/types.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/workspaces/worktree-status-refresh.ts'
import { requireGitWorkspaceForTest } from '#/web/stores/workspaces/git-workspace-projection.test-utils.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
beforeEach(resetRefreshTest)

describe('workspace refresh capability', () => {
  test('refreshes a plain Workspace and projects Git only after capability promotion', async () => {
    const workspaceRuntimeId = 'workspace-runtime-plain-refresh'
    const workspace = emptyWorkspace(REPO_ID, workspaceRuntimeId)
    acceptWorkspaceProbeState(workspace, {
      status: 'ready',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    })
    useWorkspacesStore.setState({ workspaces: { [REPO_ID]: workspace }, workspaceOrder: [REPO_ID] })
    const projection = vi.fn(async () => repoProjection({ branches: [branch('main')], current: 'main' }))
    ipcHandlers['workspace.refresh'] = () => ({
      kind: 'committed',
      probe: {
        status: 'ready',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
        },
        diagnostics: [],
      },
    })
    ipcHandlers['repo.projection'] = projection

    await runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    expect(useWorkspacesStore.getState().workspaces[REPO_ID]?.capability.kind).toBe('git')
    expect(projection).toHaveBeenCalledOnce()
  })

  test('coalesces concurrent explicit refreshes for the same Workspace runtime', async () => {
    const workspaceRuntimeId = 'workspace-runtime-coalesced-refresh'
    const workspace = emptyWorkspace(REPO_ID, workspaceRuntimeId)
    acceptWorkspaceProbeState(workspace, {
      status: 'ready',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    })
    useWorkspacesStore.setState({ workspaces: { [REPO_ID]: workspace }, workspaceOrder: [REPO_ID] })
    const response = Promise.withResolvers<WorkspaceRefreshResult>()
    const refresh = vi.fn(() => response.promise)
    const projection = vi.fn(async () => repoProjection({ branches: [branch('main')], current: 'main' }))
    ipcHandlers['workspace.refresh'] = refresh
    ipcHandlers['repo.projection'] = projection

    const first = runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })
    const second = runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    response.resolve({
      kind: 'committed',
      probe: {
        status: 'ready',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
        },
        diagnostics: [],
      },
    })

    await Promise.all([first, second])
    expect(refresh).toHaveBeenCalledOnce()
    expect(projection).toHaveBeenCalledOnce()
  })

  test('commits a non-Git capability transition without changing the runtime or reading Git state', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    const fetch = vi.fn()
    const projection = vi.fn()
    ipcHandlers['repo.fetch'] = fetch
    ipcHandlers['repo.projection'] = projection
    ipcHandlers['workspace.refresh'] = () => ({
      kind: 'committed',
      probe: {
        status: 'ready',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'unavailable' },
        },
        diagnostics: [],
      },
    })

    await runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(repo?.workspaceRuntimeId).toBe(workspaceRuntimeId)
    expect(repo?.capability.probe).toMatchObject({
      status: 'ready',
      capabilities: { git: { status: 'unavailable' } },
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(projection).not.toHaveBeenCalled()
  })

  test('failed Refresh Workspace preserves the last committed capability and Git projection', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    updateRepoForTest((repo) => {
      acceptWorkspaceProbeState(repo, {
        status: 'ready',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
        },
        diagnostics: [],
      })
    })
    const before = useWorkspacesStore.getState().workspaces[REPO_ID]!.capability.probe
    const fetch = vi.fn()
    const projection = vi.fn()
    ipcHandlers['repo.fetch'] = fetch
    ipcHandlers['repo.projection'] = projection
    ipcHandlers['workspace.refresh'] = () => ({
      kind: 'failed',
      probe: {
        status: 'ready',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'unavailable' },
        },
        diagnostics: [{ scope: 'git', message: 'git timed out' }],
      },
    })

    await expect(runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })).resolves.toEqual({
      ok: false,
      message: 'git timed out',
    })

    expect(useWorkspacesStore.getState().workspaces[REPO_ID]!.capability.probe).toBe(before)
    expect(fetch).not.toHaveBeenCalled()
    expect(projection).not.toHaveBeenCalled()
  })

  test('returns transport failures for a plain Workspace without creating Git state', async () => {
    const workspaceRuntimeId = 'workspace-runtime-plain-failed-refresh'
    const workspace = emptyWorkspace(REPO_ID, workspaceRuntimeId)
    acceptWorkspaceProbeState(workspace, {
      status: 'ready',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    })
    useWorkspacesStore.setState({ workspaces: { [REPO_ID]: workspace }, workspaceOrder: [REPO_ID] })
    ipcHandlers['workspace.refresh'] = () => {
      throw new Error('workspace transport unavailable')
    }

    await expect(runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })).resolves.toEqual({
      ok: false,
      message: 'workspace transport unavailable',
    })
    expect(useWorkspacesStore.getState().workspaces[REPO_ID]?.capability.kind).toBe('filesystem')
  })

  test('closing a plain Workspace cancels its in-flight capability refresh', async () => {
    const workspaceRuntimeId = 'workspace-runtime-plain-closing'
    const workspace = emptyWorkspace(REPO_ID, workspaceRuntimeId)
    acceptWorkspaceProbeState(workspace, {
      status: 'ready',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    })
    useWorkspacesStore.setState({ workspaces: { [REPO_ID]: workspace }, workspaceOrder: [REPO_ID] })
    const response = Promise.withResolvers<WorkspaceRefreshResult>()
    const refreshRequest = vi.fn(() => response.promise)
    ipcHandlers['workspace.refresh'] = refreshRequest

    const refresh = runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })
    await vi.waitFor(() => expect(refreshRequest).toHaveBeenCalledOnce())
    await expect(useWorkspacesStore.getState().closeWorkspace(REPO_ID)).resolves.toEqual({ ok: true })

    await expect(refresh).resolves.toEqual({ ok: false, cancelled: true })
    expect(useWorkspacesStore.getState().workspaces[REPO_ID]).toBeUndefined()
  })

  test('closing a plain Workspace cancels Git work created by a concurrent capability promotion', async () => {
    const workspaceRuntimeId = 'workspace-runtime-promoted-while-closing'
    const workspace = emptyWorkspace(REPO_ID, workspaceRuntimeId)
    acceptWorkspaceProbeState(workspace, {
      status: 'ready',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    })
    useWorkspacesStore.setState({ workspaces: { [REPO_ID]: workspace }, workspaceOrder: [REPO_ID] })
    const removeMembership = Promise.withResolvers<{
      openWorkspaceEntries: []
      workspacePaneTabsByTargetByWorkspace: {}
    }>()
    const removeWorkspaceEntry = vi.fn(() => removeMembership.promise)
    ipcHandlers['settings.removeWorkspaceEntry'] = removeWorkspaceEntry
    ipcHandlers['workspace.refresh'] = () => ({
      kind: 'committed',
      probe: {
        status: 'ready',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
        },
        diagnostics: [],
      },
    })
    const projectionResponse = Promise.withResolvers<GitWorkspaceRuntimeProjection>()
    const projection = vi.fn(() => projectionResponse.promise)
    ipcHandlers['repo.projection'] = projection

    const closing = useWorkspacesStore.getState().closeWorkspace(REPO_ID)
    await vi.waitFor(() => expect(removeWorkspaceEntry).toHaveBeenCalledOnce())
    const refresh = runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })
    await vi.waitFor(() => expect(projection).toHaveBeenCalledOnce())

    removeMembership.resolve({ openWorkspaceEntries: [], workspacePaneTabsByTargetByWorkspace: {} })
    await expect(closing).resolves.toEqual({ ok: true })
    await expect(refresh).resolves.toEqual({ ok: true })
    expect(useWorkspacesStore.getState().workspaces[REPO_ID]).toBeUndefined()
  })

  test('repo read-model projection refresh treats query projection branches as existing data while loading', async () => {
    const workspaceRuntimeId = seedRepo([])
    seedRepoReadModelQueryData(
      { id: REPO_ID, workspaceRuntimeId: workspaceRuntimeId },
      {
        branches: [branch('feature/query')],
        currentBranch: 'feature/query',
      },
    )
    let resolveSnapshot!: (value: { branches: ReturnType<typeof branch>[]; current: string }) => void
    ipcHandlers['repo.projection'] = () =>
      new Promise((resolve) => {
        resolveSnapshot = (snapshot) => resolve(repoProjection(snapshot))
      })

    const work = requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })
    await vi.waitFor(() => {
      expect(resolveSnapshot).toEqual(expect.any(Function))
    })

    expect(
      requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.dataLoads
        .repoReadModel.phase,
    ).toBe('refreshing')

    resolveSnapshot({ branches: [branch('feature/query')], current: 'feature/query' })
    await work
  })
})
