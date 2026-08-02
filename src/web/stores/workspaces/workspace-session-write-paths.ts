import PQueue from 'p-queue'
import { disposeRepoOperationScheduler } from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import { cancelWorkspaceCapabilityRefreshes } from '#/web/workspace-capability-refresh.ts'
import { requestRepoSnapshotRefresh } from '#/web/stores/workspaces/refresh.ts'
import {
  closeWorkspaceRuntime,
  openWorkspaceRuntime,
  openWorkspaceRuntimeForInput,
  reconcileWorkspaceRuntimeMemberships,
} from '#/web/workspace-client.ts'
import { addWorkspaceToSession, recordRecentWorkspace, removeWorkspaceFromSession } from '#/web/settings-actions.ts'
import {
  invalidateWorkspaceRuntimes,
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
import { runWorkspaceRefresh } from '#/web/stores/workspaces/workspace-refresh-command.ts'
import {
  acceptRemoteWorkspaceLifecycleSnapshot,
  acceptRemoteWorkspaceRuntimeProjection,
} from '#/web/stores/workspaces/remote-workspace-lifecycle-projection.ts'
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
  workspaceShellForReconciledRuntimeEpoch,
  type ResolvedWorkspace,
} from '#/web/stores/workspaces/workspace-session-state.ts'

export interface RuntimeOpenResolvedWorkspace {
  input: string
  reason: string | null
  workspace: ResolvedWorkspace | null
  workspaceRuntimeId: string | null
  workspaceProbe?: WorkspaceProbeState
}

const workspaceRuntimeMembershipQueues = new Map<string, PQueue>()
const workspaceCommandQueues = new Map<string, PQueue>()
const activeWorkspaceRuntimeMembershipCommands = new Set<Promise<unknown>>()
let workspaceRuntimeMembershipExclusiveTail: Promise<void> = Promise.resolve()

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
  } catch (err) {
    await refreshWorkspaceRuntimes()
    throw err
  } finally {
    clearWorkspacePaneTabsProjectionState(workspaceId, workspaceRuntimeId)
    disposeRepoRuntimeReadState(workspaceId, workspaceRuntimeId)
    appQueryClient.removeQueries({ queryKey: repoDataQueryKey(workspaceId, workspaceRuntimeId) })
  }
}

export type WorkspaceRuntimeMembershipRecoveryResult =
  | {
      kind: 'settled'
      targets: Array<{ workspaceId: WorkspaceId; workspaceRuntimeId: string }>
      changedTargets: Array<{
        workspaceId: WorkspaceId
        previousWorkspaceRuntimeId: string
        workspaceRuntimeId: string
      }>
    }
  | { kind: 'superseded' }

type SettledWorkspaceRuntimeMembershipRecovery = Extract<WorkspaceRuntimeMembershipRecoveryResult, { kind: 'settled' }>
type ReconciledWorkspaceRuntimeMembershipRecovery = WorkspaceRuntimeMembershipRecoveryResult & {
  remoteEnsureTargets?: Array<{ workspaceId: WorkspaceId; workspaceRuntimeId: string }>
}
type CapturedWorkspaceRuntimeMembershipRecovery = SettledWorkspaceRuntimeMembershipRecovery & {
  remoteEnsureTargets: Array<{ workspaceId: WorkspaceId; workspaceRuntimeId: string }>
}
type ChangedWorkspaceRuntimeTarget = SettledWorkspaceRuntimeMembershipRecovery['changedTargets'][number]

/**
 * Re-declares this window's complete workspace membership after realtime recovery,
 * then atomically advances every still-current shell to the server's canonical
 * runtime epoch. Changed targets remain eligible for downstream projection
 * recovery only after their one-shot capability command succeeds.
 *
 * Capability commands stay outside membership admission. #359 accepts that
 * overlapping recovery may project a settling epoch instead of adding generation joining.
 */
export async function reconcileOpenWorkspaceRuntimeMemberships(
  set: WorkspacesSet,
  get: WorkspacesGet,
): Promise<WorkspaceRuntimeMembershipRecoveryResult> {
  const recovery = await runExclusiveWorkspaceRuntimeMembershipCommand(
    async () => await reconcileOpenWorkspaceRuntimeMembershipsNow(set, get),
  )
  if (recovery.kind === 'superseded') return recovery
  const changedRemoteWorkspaceIds = new Set(
    recovery.changedTargets
      .filter((target) => isRemoteWorkspaceId(target.workspaceId))
      .map((target) => target.workspaceId),
  )
  void Promise.all(
    (recovery.remoteEnsureTargets ?? [])
      .filter((target) => !changedRemoteWorkspaceIds.has(target.workspaceId))
      .map(async (target) => {
        await runRemoteWorkspaceConnection(set, get, target.workspaceId, {
          workspaceRuntimeId: target.workspaceRuntimeId,
          mode: 'ensure',
        })
      }),
  ).catch((err) => {
    workspacesLog.warn('failed to ensure remote lifecycle after runtime membership recovery', { err })
  })
  const remoteEnsureWorkspaceIds = new Set((recovery.remoteEnsureTargets ?? []).map((target) => target.workspaceId))
  // Settle one batch before projection recovery. #359 accepts cross-workspace
  // delay instead of adding per-target generation coordination.
  const changedTargetEligibility = await Promise.all(
    recovery.changedTargets.map(async (target) => ({
      workspaceId: target.workspaceId,
      eligible: await settleChangedWorkspaceRuntimeForProjection(
        set,
        get,
        target,
        remoteEnsureWorkspaceIds.has(target.workspaceId),
      ),
    })),
  )
  const ineligibleWorkspaceIds = new Set(
    changedTargetEligibility.filter((target) => !target.eligible).map((target) => target.workspaceId),
  )
  return {
    kind: 'settled',
    targets: recovery.targets.filter((target) => !ineligibleWorkspaceIds.has(target.workspaceId)),
    changedTargets: recovery.changedTargets,
  }
}

async function settleChangedWorkspaceRuntimeForProjection(
  set: WorkspacesSet,
  get: WorkspacesGet,
  target: ChangedWorkspaceRuntimeTarget,
  remoteEnsureRequired: boolean,
): Promise<boolean> {
  if (isRemoteWorkspaceId(target.workspaceId)) {
    if (remoteEnsureRequired) {
      const outcome = await runRemoteWorkspaceConnection(set, get, target.workspaceId, {
        workspaceRuntimeId: target.workspaceRuntimeId,
        mode: 'ensure',
      })
      return outcome?.kind === 'ready'
    }
    const workspace = get().workspaces[target.workspaceId]
    return (
      workspace?.workspaceRuntimeId === target.workspaceRuntimeId &&
      workspace.admission.kind === 'remote' &&
      workspace.admission.lifecycle?.kind === 'ready'
    )
  }

  try {
    const outcome = await runWorkspaceRefresh({ set, get }, target.workspaceId, {
      workspaceRuntimeId: target.workspaceRuntimeId,
    })
    if (outcome.ok) return true
    if ('cancelled' in outcome) return false
    workspacesLog.warn('workspace refresh did not recover the changed local runtime', {
      workspaceId: target.workspaceId,
      workspaceRuntimeId: target.workspaceRuntimeId,
      message: outcome.message,
    })
    return false
  } catch (err) {
    workspacesLog.warn('workspace refresh failed after local runtime epoch replacement', {
      workspaceId: target.workspaceId,
      workspaceRuntimeId: target.workspaceRuntimeId,
      err,
    })
    return false
  }
}

async function reconcileOpenWorkspaceRuntimeMembershipsNow(
  set: WorkspacesSet,
  get: WorkspacesGet,
): Promise<ReconciledWorkspaceRuntimeMembershipRecovery> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const capturedRecovery = await reconcileCapturedWorkspaceRuntimeMemberships(set, get)
    if (capturedRecovery) {
      return {
        kind: 'settled',
        targets: capturedRecovery.targets,
        changedTargets: capturedRecovery.changedTargets,
        remoteEnsureTargets: capturedRecovery.remoteEnsureTargets,
      }
    }
  }
  return { kind: 'superseded' }
}

async function reconcileCapturedWorkspaceRuntimeMemberships(
  set: WorkspacesSet,
  get: WorkspacesGet,
): Promise<CapturedWorkspaceRuntimeMembershipRecovery | null> {
  const captured = Object.values(get().workspaces).map((workspace) => ({
    workspaceId: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
  }))
  const response = await reconcileWorkspaceRuntimeMemberships(captured.map((entry) => entry.workspaceId))
  const runtimeByWorkspaceId = new Map(response.runtimes.map((entry) => [entry.workspaceId, entry]))
  const runtimeSnapshot = await invalidateWorkspaceRuntimes()
  const currentWorkspaceIds = Object.values(get().workspaces).map((workspace) => workspace.id)
  if (
    !sameWorkspaceIdSet(
      currentWorkspaceIds,
      captured.map((entry) => entry.workspaceId),
    )
  )
    return null
  const changedTargets: SettledWorkspaceRuntimeMembershipRecovery['changedTargets'] = []

  set((state) => {
    let workspaces = state.workspaces
    for (const previous of captured) {
      const current = workspaces[previous.workspaceId]
      const runtime = runtimeByWorkspaceId.get(previous.workspaceId)
      if (!current || current.workspaceRuntimeId !== previous.workspaceRuntimeId || !runtime) continue
      if (runtime.workspaceRuntimeId === previous.workspaceRuntimeId) continue
      if (workspaces === state.workspaces) workspaces = { ...state.workspaces }
      workspaces[previous.workspaceId] = workspaceShellForReconciledRuntimeEpoch(
        current,
        runtime.workspaceRuntimeId,
        runtime.workspaceProbe,
      )
      changedTargets.push({
        workspaceId: previous.workspaceId,
        previousWorkspaceRuntimeId: previous.workspaceRuntimeId,
        workspaceRuntimeId: runtime.workspaceRuntimeId,
      })
    }
    return workspaces === state.workspaces ? state : { ...state, workspaces }
  })

  for (const changed of changedTargets) {
    cancelWorkspaceCapabilityRefreshes(changed.workspaceId, changed.previousWorkspaceRuntimeId)
    disposeRepoOperationScheduler(changed.workspaceId)
    clearWorkspacePaneTabsProjectionState(changed.workspaceId, changed.previousWorkspaceRuntimeId)
    appQueryClient.removeQueries({
      queryKey: repoDataQueryKey(changed.workspaceId, changed.previousWorkspaceRuntimeId),
    })
    disposeRepoRuntimeReadState(changed.workspaceId, changed.previousWorkspaceRuntimeId)
  }
  for (const changed of changedTargets) {
    if (!isRemoteWorkspaceId(changed.workspaceId)) continue
    const runtime = runtimeByWorkspaceId.get(changed.workspaceId)
    if (runtime) acceptRemoteWorkspaceRuntimeProjection(set, get, runtime)
  }
  acceptRemoteWorkspaceLifecycleSnapshot(set, get, runtimeSnapshot)

  const currentWorkspaces = get().workspaces
  const targets: SettledWorkspaceRuntimeMembershipRecovery['targets'] = []
  const remoteEnsureTargets: Array<{ workspaceId: WorkspaceId; workspaceRuntimeId: string }> = []
  for (const { workspaceId } of captured) {
    const currentWorkspaceRuntimeId = currentWorkspaces[workspaceId]?.workspaceRuntimeId
    if (!currentWorkspaceRuntimeId) continue
    targets.push({ workspaceId, workspaceRuntimeId: currentWorkspaceRuntimeId })

    const runtime = runtimeByWorkspaceId.get(workspaceId)
    if (
      runtime &&
      isRemoteWorkspaceId(workspaceId) &&
      currentWorkspaceRuntimeId === runtime.workspaceRuntimeId &&
      ['idle', 'connecting'].includes(runtime.remoteLifecycle?.kind ?? '')
    ) {
      remoteEnsureTargets.push({ workspaceId, workspaceRuntimeId: runtime.workspaceRuntimeId })
    }
  }

  return {
    kind: 'settled',
    targets,
    changedTargets,
    remoteEnsureTargets,
  }
}

function sameWorkspaceIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((workspaceId) => rightSet.has(workspaceId))
}

async function runWorkspaceRuntimeMembershipCommand<T>(workspaceKey: string, command: () => Promise<T>): Promise<T> {
  const precedingExclusive = workspaceRuntimeMembershipExclusiveTail
  let queue = workspaceRuntimeMembershipQueues.get(workspaceKey)
  if (!queue) {
    queue = new PQueue({ concurrency: 1 })
    workspaceRuntimeMembershipQueues.set(workspaceKey, queue)
  }
  const work = (async () => {
    await precedingExclusive
    return await queue.add(command)
  })()
  activeWorkspaceRuntimeMembershipCommands.add(work)
  try {
    return await work
  } finally {
    activeWorkspaceRuntimeMembershipCommands.delete(work)
    void queue.onIdle().then(() => {
      if (workspaceRuntimeMembershipQueues.get(workspaceKey) === queue && queue.size === 0 && queue.pending === 0) {
        workspaceRuntimeMembershipQueues.delete(workspaceKey)
      }
    })
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

async function runExclusiveWorkspaceRuntimeMembershipCommand<T>(command: () => Promise<T>): Promise<T> {
  const precedingExclusive = workspaceRuntimeMembershipExclusiveTail
  const precedingShared = Array.from(activeWorkspaceRuntimeMembershipCommands)
  const work = (async () => {
    await precedingExclusive
    await Promise.allSettled(precedingShared)
    return await command()
  })()
  workspaceRuntimeMembershipExclusiveTail = work.then(
    () => undefined,
    () => undefined,
  )
  return await work
}

async function rollbackNewWorkspace(
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
    workspacesLog.warn('failed to release workspace runtime after workspace membership write failed', {
      workspaceId,
      workspaceRuntimeId,
      err,
    })
    try {
      await invalidateWorkspaceRuntimes()
    } catch (refreshErr) {
      workspacesLog.warn('failed to refresh workspace runtimes after workspace open rollback', {
        workspaceId,
        workspaceRuntimeId,
        err: refreshErr,
      })
    }
  }
}

type WorkspaceMembershipWriteResult = { ok: true } | { ok: false; error: unknown }

async function addWorkspaceMembershipResult(entry: WorkspaceSessionEntry): Promise<WorkspaceMembershipWriteResult> {
  try {
    await addWorkspaceToSession(entry)
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

async function removeWorkspaceMembershipResult(workspaceId: WorkspaceId): Promise<WorkspaceMembershipWriteResult> {
  try {
    await removeWorkspaceFromSession(workspaceId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

async function releaseUncommittedWorkspaceRuntime(workspaceId: WorkspaceId, workspaceRuntimeId: string): Promise<void> {
  try {
    await closeWorkspaceRuntimeWithCacheNow(workspaceId, workspaceRuntimeId)
  } catch (err) {
    workspacesLog.warn('failed to release uncommitted workspace runtime', { workspaceId, workspaceRuntimeId, err })
  }
}

async function recordRecentWorkspacePostOpen(workspace: WorkspaceSessionEntry): Promise<OpenWorkspacePostOpenError[]> {
  try {
    await recordRecentWorkspace(workspace)
    return []
  } catch (err) {
    workspacesLog.warn('failed to record recent workspace after opening workspace', { workspace, err })
    return [
      { kind: 'recent-workspace', message: err instanceof Error ? err.message : 'workspace-picker.recent-save-failed' },
    ]
  }
}

export function refreshInitialWorkspaceState(set: WorkspacesSet, get: WorkspacesGet, refresh: InitialWorkspaceRefresh) {
  const workspace = get().workspaces[refresh.id]
  if (!workspace || workspace.workspaceRuntimeId !== refresh.workspaceRuntimeId) return
  if (workspace.capability.kind !== 'git') return
  void requestRepoSnapshotRefresh({ get, set }, refresh.id, {
    workspaceRuntimeId: refresh.workspaceRuntimeId,
  })
}

export function createWorkspaceLifecycleActions(set: WorkspacesSet, get: WorkspacesGet): WorkspaceMembershipActions {
  return {
    async ensureWorkspaceOpen(pathOrEntry: string | WorkspaceSessionEntry): Promise<OpenWorkspaceResult> {
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
      if (outcome.kind === 'transport-failed') return { ok: false, reason: outcome.reason }
      if (outcome.kind === 'ready') return { ok: true }
      return { ok: false, reason: outcome.reason ?? 'unknown' }
    },
  }
}

async function openLocalWorkspace(
  set: WorkspacesSet,
  get: WorkspacesGet,
  workspaceInput: string,
): Promise<OpenWorkspaceResult> {
  const initialRefreshRef: { current: InitialWorkspaceRefresh | null } = { current: null }
  const resolved = await runWorkspaceRuntimeMembershipCommand(workspaceInput, async () => {
    const opened = await openLocalWorkspaceRuntimeForCommandInput(workspaceInput)
    if (!opened.workspace || !opened.workspaceRuntimeId) return opened
    const workspace = opened.workspace
    const workspaceRuntimeId = opened.workspaceRuntimeId
    const workspaceEntry = workspace.target ? remoteWorkspaceSessionEntry(workspace.target) : { id: workspace.id }
    const membership = await addWorkspaceMembershipResult(workspaceEntry)
    if (!membership.ok) {
      workspacesLog.warn('failed to add local workspace to server workspace', {
        workspaceId: workspace.id,
        err: membership.error,
      })
      await releaseUncommittedWorkspaceRuntime(workspace.id, workspaceRuntimeId)
      return { ...opened, reason: 'error.workspace-open-failed', workspace: null, workspaceRuntimeId: null }
    }
    set((state) => {
      const { workspaces, workspaceOrder, changed } = addResolvedWorkspace(state, workspace, workspaceRuntimeId)
      if (changed)
        initialRefreshRef.current = {
          id: workspace.id,
          workspaceRuntimeId: workspaces[workspace.id]!.workspaceRuntimeId,
        }
      return changed ? { workspaces, workspaceOrder } : state
    })
    return opened
  })
  if (!resolved.workspace || !resolved.workspaceRuntimeId) {
    return { ok: false, message: resolved.reason ?? 'error.workspace-open-failed' }
  }
  if (initialRefreshRef.current) refreshInitialWorkspaceState(set, get, initialRefreshRef.current)
  const recentEntry = resolved.workspace.target
    ? remoteWorkspaceSessionEntry(resolved.workspace.target)
    : localWorkspaceSessionEntry(resolved.workspace.id)
  return { ok: true, workspaceId: resolved.workspace.id, postOpenEffects: recordRecentWorkspacePostOpen(recentEntry) }
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
    const membership = await addWorkspaceMembershipResult(entry)
    if (!membership.ok) {
      if (openedWorkspaceRuntimeId) await rollbackNewWorkspace(set, get, entry.id, openedWorkspaceRuntimeId)
      workspacesLog.warn('failed to add remote workspace to server workspace', {
        workspaceId: entry.id,
        err: membership.error,
      })
      return null
    }
    return { workspaceRuntimeId }
  })
  if (!prepared) return { ok: false, message: 'error.workspace-open-failed' }

  const outcome = await runRemoteWorkspaceConnection(set, get, entry.id, {
    workspaceRuntimeId: prepared.workspaceRuntimeId,
  })
  if (get().workspaces[entry.id]?.workspaceRuntimeId !== prepared.workspaceRuntimeId) {
    return { ok: false, message: 'error.workspace-open-failed' }
  }
  const recentEntry = outcome?.kind === 'ready' ? remoteWorkspaceSessionEntry(outcome.target) : entry
  return { ok: true, workspaceId: entry.id, postOpenEffects: recordRecentWorkspacePostOpen(recentEntry) }
}

async function closeWorkspaceMembership(
  set: WorkspacesSet,
  get: WorkspacesGet,
  workspaceId: WorkspaceId,
): Promise<CloseWorkspaceResult> {
  const workspace = get().workspaces[workspaceId]
  if (!workspace) return { ok: false, message: 'error.workspace-close-failed' }
  const workspaceRuntimeId = workspace.workspaceRuntimeId
  const membership = await removeWorkspaceMembershipResult(workspaceId)
  if (!membership.ok) {
    workspacesLog.warn('failed to remove workspace from server session', { workspaceId, err: membership.error })
    return { ok: false, message: 'error.workspace-close-failed' }
  }
  cancelWorkspaceCapabilityRefreshes(workspaceId, workspaceRuntimeId)
  disposeRepoOperationScheduler(workspaceId)
  set((state) => removeWorkspaceFromSessionState(state, workspaceId))
  try {
    await closeWorkspaceRuntimeWithCache(workspace.id, workspaceRuntimeId)
  } catch (err) {
    workspacesLog.warn('failed to close workspace runtime', { workspaceId, workspaceRuntimeId, err })
    void invalidateWorkspaceRuntimes().catch((refreshErr) => {
      workspacesLog.warn('failed to refresh workspace runtime membership after close failure', {
        workspaceId,
        workspaceRuntimeId,
        err: refreshErr,
      })
    })
  }
  return { ok: true }
}
