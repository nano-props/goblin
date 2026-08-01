import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspaceRefreshResult } from '#/shared/workspace-runtime.ts'
import { requestWorkspaceCapabilityRefresh } from '#/web/workspace-capability-refresh.ts'
import { requestRepoSnapshotRefresh } from '#/web/stores/workspaces/refresh.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/workspaces/worktree-status-refresh.ts'
import { createRefreshSyncHelpers } from '#/web/stores/workspaces/refresh-sync.ts'
import { resolveActionWorkspaceRuntimeId } from '#/web/stores/workspaces/refresh-state.ts'
import { acceptWorkspaceProbeState, updateIfFresh } from '#/web/stores/workspaces/workspace-guards.ts'
import { appendRepoEvent, errorEvent } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { gitWorkspaceClientState, isGitWorkspace } from '#/web/stores/workspaces/git-workspace-client-state.ts'
import { runExclusiveOperation } from '#/web/stores/workspaces/operation-runner.ts'
import { refreshActiveRepoPullRequestQueries } from '#/web/repo-query-runtime.ts'
import { goblinLog } from '#/web/logger.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'

export interface WorkspaceRefreshStoreAccess {
  set: WorkspacesSet
  get: WorkspacesGet
}

export type WorkspaceRefreshOutcome = { ok: true } | { ok: false; message: string } | { ok: false; cancelled: true }

const commands = new Map<string, Promise<WorkspaceRefreshOutcome>>()

export async function runWorkspaceRefresh(
  store: WorkspaceRefreshStoreAccess,
  workspaceId: WorkspaceId,
  options?: { workspaceRuntimeId?: string },
): Promise<WorkspaceRefreshOutcome> {
  const workspace = store.get().workspaces[workspaceId]
  if (!workspace) return { ok: false, cancelled: true }
  const workspaceRuntimeId = options?.workspaceRuntimeId ?? workspace.workspaceRuntimeId
  if (workspace.workspaceRuntimeId !== workspaceRuntimeId) return { ok: false, cancelled: true }
  const key = `${workspaceId}\0${workspaceRuntimeId}`
  const existing = commands.get(key)
  if (existing) return await existing
  const command = runWorkspaceRefreshOnce(store, workspaceId, workspaceRuntimeId)
  commands.set(key, command)
  try {
    return await command
  } finally {
    if (commands.get(key) === command) commands.delete(key)
  }
}

async function runWorkspaceRefreshOnce(
  store: WorkspaceRefreshStoreAccess,
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): Promise<WorkspaceRefreshOutcome> {
  const outcome = await requestWorkspaceCapabilityRefresh(workspaceId, workspaceRuntimeId)
  if (outcome.kind === 'cancelled') return { ok: false, cancelled: true }
  if (outcome.kind === 'failed') return { ok: false, message: outcome.message }
  const refreshed: WorkspaceRefreshResult = outcome.result
  if (refreshed.kind === 'stale-runtime') return { ok: false, message: 'error.workspace-runtime-stale' }
  if (refreshed.kind === 'failed') {
    const diagnostic = refreshed.probe.status === 'ready' ? refreshed.probe.diagnostics[0]?.message : undefined
    return { ok: false, message: diagnostic ?? 'error.workspace-operation-failed' }
  }
  updateIfFresh(store.set, workspaceId, workspaceRuntimeId, (workspace) => {
    acceptWorkspaceProbeState(workspace, refreshed.probe)
  })
  const resolved = resolveActionWorkspaceRuntimeId(store.get, workspaceId, workspaceRuntimeId)
  if (!resolved || !isGitWorkspace(resolved.repo)) return { ok: true }
  const { runRefreshSyncPipeline } = createRefreshSyncHelpers(store.set, store.get, {
    refreshReadModels: async (repoId, nextWorkspaceRuntimeId, signal) => {
      void refreshActiveRepoPullRequestQueries(repoId, nextWorkspaceRuntimeId).catch((error) => {
        goblinLog.warn('active pull-request refresh failed', {
          repoId,
          workspaceRuntimeId: nextWorkspaceRuntimeId,
          error,
        })
      })
      await Promise.all([
        requestRepoSnapshotRefresh(store, repoId, { workspaceRuntimeId: nextWorkspaceRuntimeId, signal }),
        refreshRepoWorktreeStatus(store, repoId, nextWorkspaceRuntimeId, { signal }),
      ])
    },
  })
  await runExclusiveOperation({
    set: store.set,
    get: store.get,
    id: workspaceId,
    workspaceRuntimeId,
    lane: 'read',
    priority: 100,
    targets: [{ key: 'workspaceRefresh', reason: 'workspace-refresh' }],
    task: async (signal) => await runRefreshSyncPipeline(workspaceId, workspaceRuntimeId, signal),
    onError: (message) => {
      updateIfFresh(store.set, workspaceId, workspaceRuntimeId, (workspace) => {
        if (!isGitWorkspace(workspace)) return
        const git = gitWorkspaceClientState(workspace)
        git.events = appendRepoEvent(git.events, errorEvent(message))
      })
    },
  })
  return { ok: true }
}
