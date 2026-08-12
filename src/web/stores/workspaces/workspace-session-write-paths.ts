import PQueue from 'p-queue'
import { disposeRepoOperationScheduler } from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import { cancelWorkspaceCapabilityRefreshes } from '#/web/workspace-capability-refresh.ts'
import { requestInitialRepoSnapshotLoad, requestRepoSnapshotRefresh } from '#/web/stores/workspaces/refresh.ts'
import { closeWorkspaceRuntime, openWorkspaceRuntime, openWorkspaceRuntimeForInput } from '#/web/workspace-client.ts'
import { addWorkspaceToSession, recordRecentWorkspace, removeWorkspaceFromSession } from '#/web/settings-actions.ts'
import {
  removeWorkspaceRuntimeFromCache,
  refreshWorkspaceRuntimes,
  updateWorkspaceRuntimeCache,
} from '#/web/workspace-runtime-query.ts'
import { clearWorkspacePaneTabsProjectionState } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacesLog } from '#/web/logger.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { disposeRepoRuntimeReadState } from '#/web/repo-query-runtime.ts'
import { repoDataQueryKey } from '#/web/repo-query-keys.ts'
import { runRemoteWorkspaceConnection } from '#/web/stores/workspaces/remote-workspace-connection-command.ts'
import type {
  CloseWorkspaceResult,
  OpenWorkspacePostOpenError,
  OpenWorkspaceResult,
  WorkspaceMembershipActions,
  WorkspacesGet,
  WorkspacesSet,
} from '#/web/stores/workspaces/types.ts'
import {
  isRemoteWorkspaceId,
  localWorkspaceSessionEntry,
  normalizeRemoteWorkspaceRef,
  parseRemoteWorkspaceId,
  remoteWorkspaceSessionEntry,
  type WorkspaceSessionEntry,
} from '#/shared/remote-workspace.ts'
import type { WorkspaceProbeState } from '#/shared/workspace-runtime.ts'
import {
  addResolvedWorkspace,
  insertPlaceholderWorkspace,
  removeWorkspaceFromSessionState,
  type ResolvedWorkspace,
} from '#/web/stores/workspaces/workspace-session-state.ts'
import { runWorkspaceRuntimeMembershipCommand } from '#/web/stores/workspaces/workspace-runtime-membership-scheduler.ts'
import { hasErrorCode } from '#/shared/error-code.ts'

export interface RuntimeOpenResolvedWorkspace {
  input: string
  reason: string | null
  workspace: ResolvedWorkspace | null
  workspaceRuntimeId: string | null
  workspaceProbe?: WorkspaceProbeState
}

const workspaceCommandQueues = new Map<string, PQueue>()

export interface InitialWorkspaceRefresh {
  id: WorkspaceId
  workspaceRuntimeId: string
}

type WorkspaceAdmissionInput =
  { kind: 'command-input'; input: string } | { kind: 'workspace-entry'; entry: WorkspaceSessionEntry }

function workspaceAdmissionFromInput(input: string | WorkspaceSessionEntry): WorkspaceAdmissionInput {
  if (typeof input !== 'string') return { kind: 'workspace-entry', entry: input }
  const parsed = parseRemoteWorkspaceId(input)
  const ref = parsed ? normalizeRemoteWorkspaceRef(parsed) : null
  return ref ? { kind: 'workspace-entry', entry: { id: ref.id } } : { kind: 'command-input', input }
}

export async function openLocalWorkspaceRuntimeForInput(
  input: string | WorkspaceSessionEntry,
  onOpened?: (opened: RuntimeOpenResolvedWorkspace) => void | Promise<void>,
): Promise<RuntimeOpenResolvedWorkspace> {
  const admission = workspaceAdmissionFromInput(input)
  const workspaceInput = admission.kind === 'workspace-entry' ? admission.entry.id : admission.input
  return await runWorkspaceRuntimeMembershipCommand(workspaceInput, async () => {
    const opened = await openLocalWorkspaceRuntimeForCommandInput(workspaceInput)
    await onOpened?.(opened)
    return opened
  })
}

async function openLocalWorkspaceRuntimeForCommandInput(workspaceInput: string): Promise<RuntimeOpenResolvedWorkspace> {
  const opened = await openWorkspaceRuntimeForInput(workspaceInput)
  if (!opened.ok) {
    return {
      input: opened.input,
      reason: opened.reason,
      workspace: null,
      workspaceRuntimeId: null,
    }
  }
  const workspaceProbe: WorkspaceProbeState = {
    status: 'ready',
    capabilities: opened.capabilities,
    diagnostics: opened.diagnostics,
  }
  await updateWorkspaceRuntimeCache({
    workspaceId: opened.workspace.id,
    workspaceRuntimeId: opened.workspaceRuntimeId,
    workspaceProbe,
  })
  return {
    input: workspaceInput,
    reason: null,
    workspace: { id: opened.workspace.id, workspaceProbe },
    workspaceRuntimeId: opened.workspaceRuntimeId,
    workspaceProbe,
  }
}

export async function openWorkspaceRuntimeWithCache(
  workspaceId: WorkspaceId,
  onOpened?: (workspaceRuntimeId: string) => void | Promise<void>,
): Promise<string> {
  return await runWorkspaceRuntimeMembershipCommand(workspaceId, async () => {
    const workspaceRuntimeId = await openWorkspaceRuntime(workspaceId)
    await updateWorkspaceRuntimeCache({ workspaceId, workspaceRuntimeId })
    await onOpened?.(workspaceRuntimeId)
    return workspaceRuntimeId
  })
}

export async function closeWorkspaceRuntimeWithCache(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): Promise<void> {
  await runWorkspaceRuntimeMembershipCommand(workspaceId, async () => {
    await closeWorkspaceRuntimeWithCacheNow(workspaceId, workspaceRuntimeId)
  })
}

async function closeWorkspaceRuntimeWithCacheNow(workspaceId: WorkspaceId, workspaceRuntimeId: string): Promise<void> {
  try {
    const released = await closeWorkspaceRuntime(workspaceId, workspaceRuntimeId)
    if (released) await removeWorkspaceRuntimeFromCache({ workspaceId, workspaceRuntimeId })
    else await refreshWorkspaceRuntimes()
  } finally {
    clearWorkspacePaneTabsProjectionState(workspaceId, workspaceRuntimeId)
    disposeRepoRuntimeReadState(workspaceId, workspaceRuntimeId)
    appQueryClient.removeQueries({ queryKey: repoDataQueryKey(workspaceId, workspaceRuntimeId) })
  }
}

async function runWorkspaceCommand<T>(workspaceKey: string, command: () => Promise<T>): Promise<T> {
  let queue = workspaceCommandQueues.get(workspaceKey)
  if (!queue) {
    queue = new PQueue({ concurrency: 1 })
    workspaceCommandQueues.set(workspaceKey, queue)
  }
  try {
    return await queue.add(command)
  } finally {
    void queue.onIdle().then(() => {
      if (workspaceCommandQueues.get(workspaceKey) === queue && queue.size === 0 && queue.pending === 0) {
        workspaceCommandQueues.delete(workspaceKey)
      }
    })
  }
}

async function discardRejectedRemoteWorkspaceOpen(
  set: WorkspacesSet,
  get: WorkspacesGet,
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): Promise<void> {
  if (get().workspaces[workspaceId]?.workspaceRuntimeId !== workspaceRuntimeId) return
  cancelWorkspaceCapabilityRefreshes(workspaceId, workspaceRuntimeId)
  disposeRepoOperationScheduler(workspaceId)
  set((state) =>
    state.workspaces[workspaceId]?.workspaceRuntimeId === workspaceRuntimeId
      ? removeWorkspaceFromSessionState(state, workspaceId)
      : state,
  )
  try {
    await closeWorkspaceRuntimeWithCache(workspaceId, workspaceRuntimeId)
  } catch (err) {
    workspacesLog.warn('failed to release workspace runtime after rejected workspace membership write', {
      workspaceId,
      workspaceRuntimeId,
      err,
    })
  }
}

type WorkspaceMembershipWriteOutcome = 'committed' | 'uncertain'

async function addWorkspaceMembership(entry: WorkspaceSessionEntry): Promise<WorkspaceMembershipWriteOutcome> {
  try {
    await addWorkspaceToSession(entry)
    return 'committed'
  } catch (error) {
    if (hasErrorCode(error, 'OUTCOME_UNCERTAIN')) return 'uncertain'
    throw error
  }
}

async function releaseRejectedWorkspaceRuntime(workspaceId: WorkspaceId, workspaceRuntimeId: string): Promise<void> {
  try {
    await closeWorkspaceRuntimeWithCacheNow(workspaceId, workspaceRuntimeId)
  } catch (err) {
    workspacesLog.warn('failed to release rejected workspace runtime', { workspaceId, workspaceRuntimeId, err })
  }
}

async function recordRecentWorkspacePostOpen(workspace: WorkspaceSessionEntry): Promise<OpenWorkspacePostOpenError[]> {
  try {
    await recordRecentWorkspace(workspace)
    return []
  } catch (err) {
    workspacesLog.warn('failed to record recent workspace after opening workspace', { workspace, err })
    if (hasErrorCode(err, 'OUTCOME_UNCERTAIN')) {
      return [{ kind: 'operation-outcome-uncertain', message: 'error.operation-outcome-uncertain' }]
    }
    return [
      { kind: 'recent-workspace', message: err instanceof Error ? err.message : 'workspace-picker.recent-save-failed' },
    ]
  }
}

export function refreshInitialWorkspaceState(set: WorkspacesSet, get: WorkspacesGet, refresh: InitialWorkspaceRefresh) {
  const workspace = get().workspaces[refresh.id]
  if (!workspace || workspace.workspaceRuntimeId !== refresh.workspaceRuntimeId) return
  if (workspace.capability.kind !== 'git') return
  void requestInitialRepoSnapshotLoad({ get, set }, refresh.id, {
    workspaceRuntimeId: refresh.workspaceRuntimeId,
  })
}

function projectResolvedWorkspaceIntoSession(
  set: WorkspacesSet,
  workspace: ResolvedWorkspace,
  workspaceRuntimeId: string,
): InitialWorkspaceRefresh | null {
  const initialRefreshRef: { current: InitialWorkspaceRefresh | null } = { current: null }
  set((state) => {
    const { workspaces, workspaceOrder, changed } = addResolvedWorkspace(state, workspace, workspaceRuntimeId)
    if (changed) {
      initialRefreshRef.current = {
        id: workspace.id,
        workspaceRuntimeId: workspaces[workspace.id]!.workspaceRuntimeId,
      }
    }
    return changed ? { workspaces, workspaceOrder } : state
  })
  return initialRefreshRef.current
}

export function createWorkspaceLifecycleActions(set: WorkspacesSet, get: WorkspacesGet): WorkspaceMembershipActions {
  return {
    async openWorkspaceMembership(pathOrEntry: string | WorkspaceSessionEntry): Promise<OpenWorkspaceResult> {
      const admission = workspaceAdmissionFromInput(pathOrEntry)
      if (admission.kind === 'workspace-entry' && isRemoteWorkspaceId(admission.entry.id)) {
        return await openRemoteWorkspace(set, get, admission.entry)
      }
      const workspaceInput = admission.kind === 'workspace-entry' ? admission.entry.id : admission.input
      return await runWorkspaceCommand(workspaceInput, async () => await openLocalWorkspace(set, get, workspaceInput))
    },

    async closeWorkspace(workspaceId: WorkspaceId): Promise<CloseWorkspaceResult> {
      return await runWorkspaceCommand(workspaceId, async () => await closeWorkspaceMembership(set, get, workspaceId))
    },

    async retryRemoteWorkspaceConnection(id: string) {
      const workspace = get().workspaces[id]
      if (workspace?.admission.kind !== 'remote') return null
      const outcome = await runRemoteWorkspaceConnection(set, get, workspace.id, { mode: 'restart' })
      if (!outcome) return null
      if (outcome.kind === 'superseded' || outcome.kind === 'stale-runtime' || outcome.kind === 'cancelled') return null
      if (outcome.kind === 'outcome-uncertain') return { ok: false, kind: 'uncertain' }
      if (outcome.kind === 'transport-failed') return { ok: false, kind: 'failed', reason: outcome.reason }
      if (outcome.kind === 'ready') return { ok: true }
      return { ok: false, kind: 'failed', reason: outcome.reason ?? 'unknown' }
    },
  }
}

async function openLocalWorkspace(
  set: WorkspacesSet,
  get: WorkspacesGet,
  workspaceInput: string,
): Promise<OpenWorkspaceResult> {
  const prepared = await runWorkspaceRuntimeMembershipCommand(workspaceInput, async () => {
    const opened = await openLocalWorkspaceRuntimeForCommandInput(workspaceInput)
    if (!opened.workspace || !opened.workspaceRuntimeId) {
      return { kind: 'rejected' as const, message: opened.reason ?? 'error.workspace-open-failed' }
    }
    const workspace = opened.workspace
    const workspaceRuntimeId = opened.workspaceRuntimeId
    const workspaceEntry = workspace.target ? remoteWorkspaceSessionEntry(workspace.target) : { id: workspace.id }
    let membershipOutcome: WorkspaceMembershipWriteOutcome
    try {
      membershipOutcome = await addWorkspaceMembership(workspaceEntry)
    } catch (error) {
      workspacesLog.warn('failed to add local workspace to server workspace', {
        workspaceId: workspace.id,
        err: error,
      })
      await releaseRejectedWorkspaceRuntime(workspace.id, workspaceRuntimeId)
      return { kind: 'rejected' as const, message: 'error.workspace-open-failed' }
    }
    const initialRefresh = projectResolvedWorkspaceIntoSession(set, workspace, workspaceRuntimeId)
    return membershipOutcome === 'uncertain'
      ? { kind: 'uncertain' as const, workspaceId: workspace.id }
      : { kind: 'prepared' as const, workspace, initialRefresh }
  })
  if (prepared.kind === 'rejected') return { ok: false, kind: 'failed', message: prepared.message }
  if (prepared.kind === 'uncertain') {
    return {
      ok: false,
      kind: 'uncertain',
      workspaceId: prepared.workspaceId,
      message: 'error.operation-outcome-uncertain',
    }
  }
  if (prepared.initialRefresh) refreshInitialWorkspaceState(set, get, prepared.initialRefresh)
  const recentEntry = prepared.workspace.target
    ? remoteWorkspaceSessionEntry(prepared.workspace.target)
    : localWorkspaceSessionEntry(prepared.workspace.id)
  return {
    ok: true,
    workspaceId: prepared.workspace.id,
    postOpenEffects: recordRecentWorkspacePostOpen(recentEntry),
  }
}

async function openRemoteWorkspace(
  set: WorkspacesSet,
  get: WorkspacesGet,
  entry: WorkspaceSessionEntry,
): Promise<OpenWorkspaceResult> {
  const prepared = await runWorkspaceCommand(entry.id, async () => {
    let openedWorkspaceRuntimeId: string | null = null
    if (!get().workspaces[entry.id]) {
      await openWorkspaceRuntimeWithCache(entry.id, (workspaceRuntimeId) => {
        openedWorkspaceRuntimeId = workspaceRuntimeId
        set((state) => {
          const result = insertPlaceholderWorkspace(
            {
              workspaces: state.workspaces,
              workspaceOrder: state.workspaceOrder,
            },
            entry,
            workspaceRuntimeId,
          )
          return { ...state, workspaces: result.workspaces, workspaceOrder: result.workspaceOrder }
        })
      })
    }
    const workspaceRuntimeId = get().workspaces[entry.id]?.workspaceRuntimeId ?? null
    if (!workspaceRuntimeId) return null
    let membershipOutcome: WorkspaceMembershipWriteOutcome
    try {
      membershipOutcome = await addWorkspaceMembership(entry)
    } catch (error) {
      if (openedWorkspaceRuntimeId) {
        await discardRejectedRemoteWorkspaceOpen(set, get, entry.id, openedWorkspaceRuntimeId)
      }
      workspacesLog.warn('failed to add remote workspace to server workspace', {
        workspaceId: entry.id,
        err: error,
      })
      return null
    }
    return membershipOutcome === 'uncertain'
      ? { kind: 'uncertain' as const, workspaceId: entry.id }
      : { kind: 'prepared' as const, workspaceRuntimeId }
  })
  if (!prepared) return { ok: false, kind: 'failed', message: 'error.workspace-open-failed' }
  if (prepared.kind === 'uncertain') {
    return {
      ok: false,
      kind: 'uncertain',
      workspaceId: prepared.workspaceId,
      message: 'error.operation-outcome-uncertain',
    }
  }

  const outcome = await runRemoteWorkspaceConnection(set, get, entry.id, {
    workspaceRuntimeId: prepared.workspaceRuntimeId,
  })
  if (outcome?.kind === 'outcome-uncertain') {
    return {
      ok: false,
      kind: 'uncertain',
      workspaceId: entry.id,
      message: 'error.operation-outcome-uncertain',
    }
  }
  if (get().workspaces[entry.id]?.workspaceRuntimeId !== prepared.workspaceRuntimeId) {
    return { ok: false, kind: 'failed', message: 'error.workspace-open-failed' }
  }
  const recentEntry = outcome?.kind === 'ready' ? remoteWorkspaceSessionEntry(outcome.target) : entry
  return {
    ok: true,
    workspaceId: entry.id,
    postOpenEffects: recordRecentWorkspacePostOpen(recentEntry),
  }
}

async function closeWorkspaceMembership(
  set: WorkspacesSet,
  get: WorkspacesGet,
  workspaceId: WorkspaceId,
): Promise<CloseWorkspaceResult> {
  const workspace = get().workspaces[workspaceId]
  if (!workspace) return { ok: false, kind: 'failed', message: 'error.workspace-close-failed' }
  const workspaceRuntimeId = workspace.workspaceRuntimeId
  try {
    await removeWorkspaceFromSession(workspaceId)
  } catch (error) {
    workspacesLog.warn('failed to remove workspace from server session', { workspaceId, err: error })
    return hasErrorCode(error, 'OUTCOME_UNCERTAIN')
      ? { ok: false, kind: 'uncertain', message: 'error.operation-outcome-uncertain' }
      : { ok: false, kind: 'failed', message: 'error.workspace-close-failed' }
  }
  cancelWorkspaceCapabilityRefreshes(workspaceId, workspaceRuntimeId)
  disposeRepoOperationScheduler(workspaceId)
  set((state) => removeWorkspaceFromSessionState(state, workspaceId))
  try {
    await closeWorkspaceRuntimeWithCache(workspace.id, workspaceRuntimeId)
  } catch (err) {
    workspacesLog.warn('failed to close workspace runtime', { workspaceId, workspaceRuntimeId, err })
  }
  return { ok: true }
}
