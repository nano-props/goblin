import { lastPathSegment } from '#/web/lib/paths.ts'
import { recordWithoutKey } from '#/shared/record.ts'
import PQueue from 'p-queue'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import {
  restoreRepoProjectionFromCacheEntry,
  seedRepoProjectionQueryFromCacheEntry,
} from '#/web/stores/workspaces/persistence.ts'
import { disposeRepoOperationScheduler } from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import { cancelWorkspaceCapabilityRefreshes } from '#/web/workspace-capability-refresh.ts'
import { requestRepoProjectionReadModelRefresh } from '#/web/stores/workspaces/refresh.ts'
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
import { parseTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { runRemoteWorkspaceConnection } from '#/web/stores/workspaces/remote-workspace-connection-command.ts'
import { acceptRemoteWorkspaceLifecycleSnapshot } from '#/web/stores/workspaces/remote-workspace-lifecycle-projection.ts'
import { markRemoteLifecycleReady } from '#/web/stores/workspaces/remote-workspace-admission.ts'
import type {
  CloseWorkspaceResult,
  OpenWorkspacePostOpenError,
  OpenWorkspaceResult,
  WorkspaceSessionProjectionState,
  WorkspacesGet,
  WorkspacesSet,
  WorkspaceState,
  WorkspacesStore,
} from '#/web/stores/workspaces/types.ts'
import { nextRestoredWorkspaceIdAfterWorkspaceClose } from '#/web/open-workspace-state.ts'
import {
  isRemoteWorkspaceId,
  localWorkspaceSessionEntry,
  normalizeRemoteWorkspaceRef,
  parseRemoteWorkspaceId,
  remoteWorkspaceConnectionTarget,
  remoteWorkspaceSessionEntry,
  sameWorkspaceSessionEntry,
  type RemoteWorkspaceTarget,
  type WorkspaceSessionEntry,
} from '#/shared/remote-workspace.ts'
import { sameWorkspaceProbeState, type WorkspaceProbeState } from '#/shared/workspace-runtime.ts'

interface ResolvedWorkspace {
  id: WorkspaceId
  name: string
  target?: RemoteWorkspaceTarget
  workspaceProbe?: WorkspaceProbeState
  session?: {
    entry: WorkspaceSessionEntry
    projectionState: WorkspaceSessionProjectionState
  }
}

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
  return ref
    ? { kind: 'workspace-entry', entry: { kind: 'remote', id: ref.id, ref } }
    : { kind: 'command-input', input }
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
    name: opened.workspace.name,
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
    workspace: { ...opened.workspace, workspaceProbe },
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

/**
 * Re-declares this window's complete workspace membership after realtime recovery,
 * then atomically advances every still-current local shell to the server's
 * canonical runtime epoch.
 */
export async function reconcileOpenWorkspaceRuntimeMemberships(
  set: WorkspacesSet,
  get: WorkspacesGet,
): Promise<WorkspaceRuntimeMembershipRecoveryResult> {
  const recovery = await runExclusiveWorkspaceRuntimeMembershipCommand(
    async () => await reconcileOpenWorkspaceRuntimeMembershipsNow(set, get),
  )
  if (recovery.kind === 'superseded') return recovery
  void Promise.all(
    (recovery.remoteEnsureTargets ?? []).map(async (target) => {
      await runRemoteWorkspaceConnection(set, get, target.workspaceId, {
        workspaceRuntimeId: target.workspaceRuntimeId,
        mode: 'ensure',
      })
    }),
  ).catch((err) => {
    workspacesLog.warn('failed to ensure remote lifecycle after runtime membership recovery', { err })
  })
  return { kind: 'settled', targets: recovery.targets, changedTargets: recovery.changedTargets }
}

async function reconcileOpenWorkspaceRuntimeMembershipsNow(
  set: WorkspacesSet,
  get: WorkspacesGet,
): Promise<ReconciledWorkspaceRuntimeMembershipRecovery> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const capturedRecovery = await reconcileCapturedWorkspaceRuntimeMemberships(set, get)
    const currentWorkspaceIds = Object.values(get().workspaces).map((workspace) => workspace.id)
    if (sameWorkspaceIdSet(currentWorkspaceIds, capturedRecovery.declaredWorkspaceIds)) {
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
): Promise<
  SettledWorkspaceRuntimeMembershipRecovery & {
    declaredWorkspaceIds: WorkspaceId[]
    remoteEnsureTargets: Array<{ workspaceId: WorkspaceId; workspaceRuntimeId: string }>
  }
> {
  const captured = Object.values(get().workspaces).map((workspace) => ({
    workspaceId: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
  }))
  const response = await reconcileWorkspaceRuntimeMemberships(captured.map((entry) => entry.workspaceId))
  const runtimeByWorkspaceId = new Map(response.runtimes.map((entry) => [entry.workspaceId, entry]))
  const changedTargets: SettledWorkspaceRuntimeMembershipRecovery['changedTargets'] = []

  set((state) => {
    let workspaces = state.workspaces
    for (const previous of captured) {
      const current = workspaces[previous.workspaceId]
      const runtime = runtimeByWorkspaceId.get(previous.workspaceId)
      if (!current || current.workspaceRuntimeId !== previous.workspaceRuntimeId || !runtime) continue
      if (runtime.workspaceRuntimeId === previous.workspaceRuntimeId) continue
      if (workspaces === state.workspaces) workspaces = { ...state.workspaces }
      workspaces[previous.workspaceId] = workspaceShellForNewRuntimeEpoch(current, runtime.workspaceRuntimeId)
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
    primaryWindowQueryClient.removeQueries({
      queryKey: ['repo-data', changed.workspaceId, changed.previousWorkspaceRuntimeId],
    })
  }
  const runtimeSnapshot = await invalidateWorkspaceRuntimes()
  acceptRemoteWorkspaceLifecycleSnapshot(set, get, runtimeSnapshot)

  return {
    kind: 'settled',
    targets: captured.flatMap(({ workspaceId }) => {
      const workspaceRuntimeId = get().workspaces[workspaceId]?.workspaceRuntimeId
      return workspaceRuntimeId ? [{ workspaceId, workspaceRuntimeId }] : []
    }),
    changedTargets,
    declaredWorkspaceIds: captured.map((entry) => entry.workspaceId),
    remoteEnsureTargets: captured.flatMap(({ workspaceId }) => {
      const runtime = runtimeByWorkspaceId.get(workspaceId)
      const currentWorkspaceRuntimeId = get().workspaces[workspaceId]?.workspaceRuntimeId
      if (
        !runtime ||
        !isRemoteWorkspaceId(workspaceId) ||
        currentWorkspaceRuntimeId !== runtime.workspaceRuntimeId ||
        !['idle', 'connecting'].includes(runtime.remoteLifecycle?.kind ?? '')
      ) {
        return []
      }
      return [{ workspaceId, workspaceRuntimeId: runtime.workspaceRuntimeId }]
    }),
  }
}

function sameWorkspaceIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((workspaceId) => rightSet.has(workspaceId))
}

function workspaceShellForNewRuntimeEpoch(workspace: WorkspaceState, workspaceRuntimeId: string): WorkspaceState {
  const next: WorkspaceState = {
    ...workspace,
    workspaceRuntimeId,
    capability: { kind: 'probing', probe: { status: 'probing' } },
  }
  if (workspace.admission.kind === 'remote') {
    next.admission = {
      kind: 'remote',
      lifecycle: null,
      lifecycleAttemptId: null,
    }
  }
  return next
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

function orderedInsert(
  workspaceOrder: WorkspaceId[],
  id: WorkspaceId,
  rankById?: ReadonlyMap<string, number>,
): WorkspaceId[] {
  if (!rankById) return [...workspaceOrder, id]
  const rank = rankById.get(id)
  if (rank === undefined) return [...workspaceOrder, id]
  const next = [...workspaceOrder]
  const index = next.findIndex((existing) => {
    const existingRank = rankById.get(existing)
    return existingRank !== undefined && existingRank > rank
  })
  next.splice(index === -1 ? next.length : index, 0, id)
  return next
}

function removeWorkspaceFromSessionState(s: WorkspacesStore, id: string): Partial<WorkspacesStore> {
  const workspace = s.workspaces[id]
  if (!workspace) return s
  const workspaces = { ...s.workspaces }
  const selectedTerminalSessionIdByTerminalFilesystemTarget = {
    ...s.selectedTerminalSessionIdByTerminalFilesystemTarget,
  }
  const tabOpenerIdentityByScope = { ...s.tabOpenerIdentityByScope }
  const navigationHistoryByWorkspace = { ...s.navigationHistoryByWorkspace }
  delete workspaces[id]
  delete navigationHistoryByWorkspace[id]
  for (const terminalFilesystemTargetKey of Object.keys(selectedTerminalSessionIdByTerminalFilesystemTarget)) {
    const target = parseTerminalFilesystemTargetKey(terminalFilesystemTargetKey)
    if (target?.workspaceId === id)
      delete selectedTerminalSessionIdByTerminalFilesystemTarget[terminalFilesystemTargetKey]
  }
  for (const scopeKey of Object.keys(tabOpenerIdentityByScope)) {
    if (scopeKey.startsWith(`${id}\0`)) delete tabOpenerIdentityByScope[scopeKey]
  }
  const workspaceOrder = s.workspaceOrder.filter((x) => x !== id)
  const restoredWorkspaceId = nextRestoredWorkspaceIdAfterWorkspaceClose(
    s.workspaceOrder,
    s.restoredWorkspaceId,
    workspace.id,
  )
  const restoredClientWorkspaceBaseline = s.restoredClientWorkspaceBaseline
    ? {
        ...s.restoredClientWorkspaceBaseline,
        preferredWorkspacePaneTabByTargetByWorkspace: recordWithoutKey(
          s.restoredClientWorkspaceBaseline.preferredWorkspacePaneTabByTargetByWorkspace,
          id,
        ),
        filetreeViewStateByWorktreeByWorkspace: recordWithoutKey(
          s.restoredClientWorkspaceBaseline.filetreeViewStateByWorktreeByWorkspace,
          id,
        ),
        selectedTerminalSessionIdByTerminalFilesystemTarget: Object.fromEntries(
          Object.entries(s.restoredClientWorkspaceBaseline.selectedTerminalSessionIdByTerminalFilesystemTarget).filter(
            ([key]) => {
              const target = parseTerminalFilesystemTargetKey(key)
              return target?.workspaceId !== id
            },
          ),
        ),
      }
    : null
  return {
    workspaces,
    selectedTerminalSessionIdByTerminalFilesystemTarget,
    tabOpenerIdentityByScope,
    navigationHistoryByWorkspace,
    workspaceOrder,
    restoredWorkspaceId,
    restoredClientWorkspaceBaseline,
  }
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

/** Build a fresh workspace by layering the restorable Git cache on top of an
 *  empty shell. `nameHints` is consulted in workspaceOrder; the first non-empty
 *  hint wins, then the cached name, then the last path segment of the
 *  id. The caller may settle admission before returning it from
 *  `upsertWorkspace.create`. */
function buildNewWorkspace(
  s: Pick<WorkspacesStore, 'repoSnapshotCache'>,
  id: WorkspaceId,
  nameHints: ReadonlyArray<string | undefined | null>,
  workspaceRuntimeId: string,
): WorkspaceState {
  const cached = s.repoSnapshotCache[id]
  const hint = nameHints.find((value): value is string => !!value)
  const name = hint ?? cached?.name ?? lastPathSegment(id)
  seedRepoProjectionQueryFromCacheEntry(id, workspaceRuntimeId, cached)
  return emptyWorkspace(id, name, workspaceRuntimeId)
}

function remoteTargetsEqual(
  a: RemoteWorkspaceTarget | undefined | null,
  b: RemoteWorkspaceTarget | undefined,
): boolean {
  if (!a || !b) return false
  return (
    a.alias === b.alias &&
    a.host === b.host &&
    a.user === b.user &&
    a.port === b.port &&
    a.remotePath === b.remotePath &&
    a.displayName === b.displayName
  )
}

function sessionEntryForResolvedWorkspace(resolvedWorkspace: ResolvedWorkspace): WorkspaceSessionEntry {
  return (
    resolvedWorkspace.session?.entry ??
    (resolvedWorkspace.target
      ? remoteWorkspaceSessionEntry(resolvedWorkspace.target)
      : localWorkspaceSessionEntry(resolvedWorkspace.id))
  )
}

function sessionProjectionStateForResolvedWorkspace(
  resolvedWorkspace: ResolvedWorkspace,
): WorkspaceSessionProjectionState {
  return resolvedWorkspace.session?.projectionState ?? 'projected'
}

function capabilityAcrossRuntimeTransition(
  workspace: WorkspaceState,
  workspaceRuntimeId: string,
): WorkspaceState['capability'] {
  return workspace.workspaceRuntimeId === workspaceRuntimeId
    ? workspace.capability
    : { kind: 'probing', probe: { status: 'probing' } }
}

/** Upsert a workspace by id, centralising the "if it exists, mutate; if
 *  not, create + insert" pattern shared by addResolvedWorkspace,
 *  addResolvedWorkspace and insertPlaceholderWorkspace.
 *  - `create` runs when the id is new and returns the new workspace.
 *  - `update`, when provided, runs against the existing workspace and
 *    returns the updated state, or `null` to signal "no change". The
 *    returned `changed` is true exactly when the produced state
 *    differs from the input state — true for new workspaces, true for
 *    any in-place update that returns a non-null value, false when
 *    the existing workspace was preserved (no-op or update returned null). */
function upsertWorkspace(
  s: Pick<WorkspacesStore, 'workspaces' | 'repoSnapshotCache' | 'workspaceOrder'>,
  id: WorkspaceId,
  options: {
    rankById?: ReadonlyMap<string, number>
    create: () => WorkspaceState
    update?: (existing: WorkspaceState) => WorkspaceState | null
  },
): Pick<WorkspacesStore, 'workspaces' | 'workspaceOrder'> & { changed: boolean; id: WorkspaceId } {
  const existing = s.workspaces[id]
  if (existing) {
    if (!options.update) return { workspaces: s.workspaces, workspaceOrder: s.workspaceOrder, changed: false, id }
    const updated = options.update(existing)
    if (!updated) return { workspaces: s.workspaces, workspaceOrder: s.workspaceOrder, changed: false, id }
    return {
      workspaces: { ...s.workspaces, [id]: updated },
      workspaceOrder: s.workspaceOrder,
      changed: true,
      id,
    }
  }
  return {
    workspaces: { ...s.workspaces, [id]: options.create() },
    workspaceOrder: orderedInsert(s.workspaceOrder, id, options.rankById),
    changed: true,
    id,
  }
}

export function addResolvedWorkspace(
  s: Pick<WorkspacesStore, 'workspaces' | 'repoSnapshotCache' | 'workspaceOrder'>,
  resolvedWorkspace: ResolvedWorkspace,
  workspaceRuntimeId: string,
  rankById?: ReadonlyMap<string, number>,
): Pick<WorkspacesStore, 'workspaces' | 'workspaceOrder'> & { changed: boolean; id: WorkspaceId } {
  return upsertWorkspace(s, resolvedWorkspace.id, {
    rankById,
    create: () => {
      const workspace = buildNewWorkspace(s, resolvedWorkspace.id, [resolvedWorkspace.name], workspaceRuntimeId)
      workspace.session = {
        entry: sessionEntryForResolvedWorkspace(resolvedWorkspace),
        projectionState: sessionProjectionStateForResolvedWorkspace(resolvedWorkspace),
      }
      // Local resolves carry no target, so `lifecycle` stays null
      // (emptyWorkspace's default). Remote resolves with a target settle
      // to 'ready'. The `addResolvedWorkspace` write path is only ever
      // reached for a remote entry with a target — the failure
      // branch in workspace runtime resolution retains the unavailable probe instead.
      if (resolvedWorkspace.workspaceProbe) {
        acceptWorkspaceProbeState(workspace, resolvedWorkspace.workspaceProbe)
      }
      const restored = restoreRepoProjectionFromCacheEntry(workspace, s.repoSnapshotCache[resolvedWorkspace.id])
      if (resolvedWorkspace.target) markRemoteLifecycleReady(restored, resolvedWorkspace.target)
      return restored
    },
    update: (existing) => {
      const hadGitProjection = existing.capability.kind === 'git'
      const runtimeChanged = existing.workspaceRuntimeId !== workspaceRuntimeId
      const preserveGitProjection = !runtimeChanged && hadGitProjection
      const nameChanged = resolvedWorkspace.name.length > 0 && existing.name !== resolvedWorkspace.name
      const sessionEntry = sessionEntryForResolvedWorkspace(resolvedWorkspace)
      const sessionProjectionState = sessionProjectionStateForResolvedWorkspace(resolvedWorkspace)
      const sessionChanged =
        existing.session.projectionState !== sessionProjectionState ||
        !sameWorkspaceSessionEntry(existing.session.entry, sessionEntry)
      const workspaceProbeChanged =
        !!resolvedWorkspace.workspaceProbe &&
        !sameWorkspaceProbeState(existing.capability.probe, resolvedWorkspace.workspaceProbe)
      if (!resolvedWorkspace.target) {
        if (!runtimeChanged && !nameChanged && !sessionChanged && !workspaceProbeChanged) return null
        const next: WorkspaceState = {
          ...existing,
          workspaceRuntimeId: runtimeChanged ? workspaceRuntimeId : existing.workspaceRuntimeId,
          name: nameChanged ? resolvedWorkspace.name : existing.name,
          session: {
            entry: sessionEntry,
            projectionState: sessionProjectionState,
          },
          capability: capabilityAcrossRuntimeTransition(existing, workspaceRuntimeId),
        }
        if (resolvedWorkspace.workspaceProbe) acceptWorkspaceProbeState(next, resolvedWorkspace.workspaceProbe)
        return preserveGitProjection
          ? next
          : restoreRepoProjectionFromCacheEntry(next, s.repoSnapshotCache[resolvedWorkspace.id])
      }
      const lifecycleReady = existing.admission.kind === 'remote' && existing.admission.lifecycle?.kind === 'ready'
      const targetChanged = !remoteTargetsEqual(
        existing.admission.kind === 'remote' ? remoteWorkspaceConnectionTarget(existing.admission.lifecycle) : null,
        resolvedWorkspace.target,
      )
      if (
        !runtimeChanged &&
        !nameChanged &&
        !sessionChanged &&
        !workspaceProbeChanged &&
        lifecycleReady &&
        !targetChanged
      ) {
        return null
      }
      // Promote the existing remote workspace from 'connecting' or
      // 'failed' to 'ready' even when the retained target is the
      // same. The converged lifecycle result is authoritative; target
      // equality alone does not prove the workspace is already ready.
      const next: WorkspaceState = {
        ...existing,
        workspaceRuntimeId: runtimeChanged ? workspaceRuntimeId : existing.workspaceRuntimeId,
        name: nameChanged ? resolvedWorkspace.name : existing.name,
        session: {
          entry: sessionEntry,
          projectionState: sessionProjectionState,
        },
        capability: capabilityAcrossRuntimeTransition(existing, workspaceRuntimeId),
        admission:
          existing.admission.kind === 'remote'
            ? {
                kind: 'remote',
                lifecycle: existing.admission.lifecycle,
                lifecycleAttemptId: existing.admission.lifecycleAttemptId,
              }
            : existing.admission,
      }
      if (resolvedWorkspace.workspaceProbe) acceptWorkspaceProbeState(next, resolvedWorkspace.workspaceProbe)
      const restored = preserveGitProjection
        ? next
        : restoreRepoProjectionFromCacheEntry(next, s.repoSnapshotCache[resolvedWorkspace.id])
      markRemoteLifecycleReady(restored, resolvedWorkspace.target)
      return restored
    },
  })
}

/**
 * Insert a placeholder workspace for a session entry whose probe is still in
 * flight. The placeholder paints the cached branch projection (if any)
 * immediately; the derived connectivity naturally reads as 'connecting'
 * because no remote target has been resolved yet. The probe resolution
 * then promotes it to 'connected' or 'unreachable' via addResolvedWorkspace /
 * the authoritative runtime projection. No-op if the workspace is already in the store (so
 * calling this twice for the same entry is safe).
 *
 * Note: the ref only carries alias/remotePath; host/user/port require
 * `resolveRemoteWorkspaceTarget`, which hasn't run yet. Until the probe
 * succeeds and addResolvedWorkspace fills in the target, the placeholder lives
 * in a "known alias, unknown concrete host" state —
 * `deriveWorkspaceConnectivity(workspace) === 'connecting'` is the signal callers should
 * branch on rather than reading target fields.
 */
export function insertPlaceholderWorkspace(
  s: Pick<WorkspacesStore, 'workspaces' | 'repoSnapshotCache' | 'workspaceOrder'>,
  entry: WorkspaceSessionEntry,
  workspaceRuntimeId: string,
  rankById?: ReadonlyMap<string, number>,
): Pick<WorkspacesStore, 'workspaces' | 'workspaceOrder'> & { changed: boolean; id: WorkspaceId } {
  return upsertWorkspace(s, entry.id, {
    rankById,
    create: () => {
      const fallbackName = entry.kind === 'remote' ? entry.ref.displayName : null
      const workspace = buildNewWorkspace(s, entry.id, [fallbackName], workspaceRuntimeId)
      workspace.session = {
        entry,
        projectionState: 'projected',
      }
      // A remote shell with no accepted server lifecycle derives as connecting;
      // only the authoritative runtime projection may settle that lifecycle.
      return workspace
    },
  })
}

export function refreshInitialWorkspaceState(set: WorkspacesSet, get: WorkspacesGet, refresh: InitialWorkspaceRefresh) {
  const workspace = get().workspaces[refresh.id]
  if (!workspace || workspace.workspaceRuntimeId !== refresh.workspaceRuntimeId) return
  if (workspace.capability.kind !== 'git') return
  void requestRepoProjectionReadModelRefresh({ get, set }, refresh.id, {
    workspaceRuntimeId: refresh.workspaceRuntimeId,
  })
}

export function createWorkspaceLifecycleActions(
  set: WorkspacesSet,
  get: WorkspacesGet,
): Pick<WorkspacesStore, 'ensureWorkspaceOpen' | 'closeWorkspace' | 'retryRemoteWorkspaceConnection'> {
  return {
    async ensureWorkspaceOpen(pathOrEntry: string | WorkspaceSessionEntry): Promise<OpenWorkspaceResult> {
      const admission = workspaceAdmissionFromInput(pathOrEntry)
      if (admission.kind === 'workspace-entry' && admission.entry.kind === 'remote') {
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
      const outcome = await runRemoteWorkspaceConnection(set, get, workspace.id)
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
    const workspaceEntry = workspace.target
      ? remoteWorkspaceSessionEntry(workspace.target)
      : { kind: 'local' as const, id: workspace.id }
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
    : { kind: 'local' as const, id: resolved.workspace.id }
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
              repoSnapshotCache: state.repoSnapshotCache,
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
