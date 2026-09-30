import { beforeEach, describe, expect, test, vi } from 'vitest'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { runWorkspaceRefresh } from '#/web/stores/workspaces/workspace-refresh-command.ts'
import {
  branch,
  REPO_ID,
  resetRefreshTest,
  serverHandlers,
  seedRepo,
  repoSnapshotResponse,
  refreshStoreAccess,
  updateRepoForTest,
} from '#/web/stores/workspaces/refresh-test-utils.ts'
import type { RepoSnapshotResponse } from '#/shared/api-types.ts'
import type { WorkspaceRefreshResult } from '#/shared/workspace-runtime.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'

function seedFilesystemWorkspace(workspaceRuntimeId: string): void {
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
  workspacesStore.setState({ workspaces: { [REPO_ID]: workspace }, workspaceOrder: [REPO_ID] })
}

beforeEach(resetRefreshTest)

describe('workspace refresh capability', () => {
  test('refreshes a plain Workspace and projects Git only after capability promotion', async () => {
    const workspaceRuntimeId = 'workspace-runtime-plain-refresh'
    seedFilesystemWorkspace(workspaceRuntimeId)
    const projection = vi.fn(async () => repoSnapshotResponse({ branches: [branch('main')], current: 'main' }))
    serverHandlers['workspace.refresh'] = () => ({
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
    serverHandlers['repo.snapshot'] = projection

    await runWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    expect(workspacesStore.getState().workspaces[REPO_ID]?.capability.kind).toBe('git')
    expect(projection).toHaveBeenCalledOnce()
  })

  test('commits a non-Git capability transition without changing the runtime or reading Git state', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    const fetch = vi.fn()
    const projection = vi.fn()
    serverHandlers['repo.fetch'] = fetch
    serverHandlers['repo.snapshot'] = projection
    serverHandlers['workspace.refresh'] = () => ({
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

    await runWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    const repo = workspacesStore.getState().workspaces[REPO_ID]
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
    const before = workspacesStore.getState().workspaces[REPO_ID]!.capability.probe
    const fetch = vi.fn()
    const projection = vi.fn()
    serverHandlers['repo.fetch'] = fetch
    serverHandlers['repo.snapshot'] = projection
    serverHandlers['workspace.refresh'] = () => ({
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

    await expect(runWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })).resolves.toEqual({
      ok: false,
      kind: 'failed',
      message: 'git timed out',
    })

    expect(workspacesStore.getState().workspaces[REPO_ID]!.capability.probe).toBe(before)
    expect(fetch).not.toHaveBeenCalled()
    expect(projection).not.toHaveBeenCalled()
  })

  test('returns transport failures for a plain Workspace without creating Git state', async () => {
    const workspaceRuntimeId = 'workspace-runtime-plain-failed-refresh'
    seedFilesystemWorkspace(workspaceRuntimeId)
    serverHandlers['workspace.refresh'] = () => {
      throw new Error('workspace transport unavailable')
    }

    await expect(runWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })).resolves.toEqual({
      ok: false,
      kind: 'failed',
      message: 'workspace transport unavailable',
    })
    expect(workspacesStore.getState().workspaces[REPO_ID]?.capability.kind).toBe('filesystem')
  })

  test('closing a plain Workspace cancels its in-flight capability refresh', async () => {
    const workspaceRuntimeId = 'workspace-runtime-plain-closing'
    seedFilesystemWorkspace(workspaceRuntimeId)
    const response = Promise.withResolvers<WorkspaceRefreshResult>()
    const refreshRequest = vi.fn(() => response.promise)
    serverHandlers['workspace.refresh'] = refreshRequest

    const refresh = runWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })
    await vi.waitFor(() => expect(refreshRequest).toHaveBeenCalledOnce())
    await expect(workspacesStore.getState().closeWorkspace(REPO_ID)).resolves.toEqual({ ok: true })

    await expect(refresh).resolves.toEqual({ ok: false, kind: 'cancelled' })
    expect(workspacesStore.getState().workspaces[REPO_ID]).toBeUndefined()
  })

  test('closing a plain Workspace cancels Git work created by a concurrent capability promotion', async () => {
    const workspaceRuntimeId = 'workspace-runtime-promoted-while-closing'
    seedFilesystemWorkspace(workspaceRuntimeId)
    const removeMembership = Promise.withResolvers<{
      openWorkspaceEntries: []
      workspacePaneTabsByTargetByWorkspace: {}
    }>()
    const removeWorkspaceEntry = vi.fn(() => removeMembership.promise)
    serverHandlers['settings.removeWorkspaceEntry'] = removeWorkspaceEntry
    serverHandlers['workspace.refresh'] = () => ({
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
    const projectionResponse = Promise.withResolvers<RepoSnapshotResponse>()
    const projection = vi.fn(() => projectionResponse.promise)
    serverHandlers['repo.snapshot'] = projection

    const closing = workspacesStore.getState().closeWorkspace(REPO_ID)
    await vi.waitFor(() => expect(removeWorkspaceEntry).toHaveBeenCalledOnce())
    const refresh = runWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })
    await vi.waitFor(() => expect(projection).toHaveBeenCalledOnce())

    removeMembership.resolve({ openWorkspaceEntries: [], workspacePaneTabsByTargetByWorkspace: {} })
    await expect(closing).resolves.toEqual({ ok: true })
    await expect(refresh).resolves.toEqual({ ok: true })
    expect(workspacesStore.getState().workspaces[REPO_ID]).toBeUndefined()
  })
})
