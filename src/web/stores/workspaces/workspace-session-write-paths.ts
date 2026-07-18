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
import { requestRepoProjectionReadModelRefresh } from '#/web/stores/workspaces/refresh.ts'
import { abortRepoOperation, probeRepo } from '#/web/repo-client.ts'
import {
  closeWorkspaceRuntime,
  openWorkspaceRuntime,
  openWorkspaceRuntimeForInput,
  reconcileWorkspaceRuntimeMemberships,
} from '#/web/workspace-client.ts'
import { resolveRemoteWorkspaceTarget } from '#/web/remote-workspace-client.ts'
import { addWorkspaceToSession, recordRecentWorkspace, removeWorkspaceFromSession } from '#/web/settings-actions.ts'
import {
  invalidateWorkspaceRuntimes,
  removeWorkspaceRuntimeFromCache,
  refreshWorkspaceRuntimes,
  updateWorkspaceRuntimeCache,
} from '#/web/workspace-runtime-query.ts'
import { clearWorkspacePaneTabsProjectionState } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacesLog } from '#/web/logger.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { runRemoteWorkspaceConnection } from '#/web/stores/workspaces/remote-workspace-connection-command.ts'
import { acceptRemoteWorkspaceLifecycleSnapshot } from '#/web/stores/workspaces/remote-workspace-lifecycle-projection.ts'
import {
  markRepoUnavailable,
  markRemoteLifecycleFailed,
  markRemoteLifecycleReady,
} from '#/web/stores/workspaces/availability.ts'
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

interface ProbeResult {
  input: string
  reason: string | null
  workspace: ResolvedWorkspace | null
  target?: RemoteWorkspaceTarget
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

export async function resolveWorkspacePath(
  input: string | WorkspaceSessionEntry,
  onError?: (err: unknown) => void,
  fallbackError = 'error.failed-read-repo',
): Promise<ProbeResult> {
  const admission = workspaceAdmissionFromInput(input)
  const value = admission.kind === 'workspace-entry' ? admission.entry : admission.input
  try {
    let target: RemoteWorkspaceTarget | undefined
    if (typeof value !== 'string' && value.kind === 'remote') target = await resolveRemoteWorkspaceTarget(value.ref)
    const repoInput = typeof value === 'string' ? value : value.id
    const probe = await probeRepo(repoInput)
    if (!probe?.ok || !probe.root) {
      return {
        input: repoInput,
        reason: probe?.message ?? 'error.repo-git-unavailable',
        workspace: null,
        target,
      }
    }
    const workspaceId = canonicalWorkspaceLocator(probe.root)
    if (!workspaceId) throw new Error('Workspace probe returned a non-canonical workspace ID')
    return {
      input: repoInput,
      reason: null,
      workspace: {
        id: workspaceId,
        name:
          probe.name ??
          (typeof value !== 'string' && value.kind === 'remote' ? value.ref.displayName : lastPathSegment(probe.root)),
        ...(target ? { target } : {}),
      },
      target,
    }
  } catch (err) {
    onError?.(err)
    return {
      input: typeof value === 'string' ? value : value.id,
      reason: err instanceof Error ? err.message : fallbackError,
      workspace: null,
    }
  }
}

export async function openLocalWorkspaceRuntimeForInput(
  input: string | WorkspaceSessionEntry,
  onOpened?: (opened: RuntimeOpenResolvedWorkspace) => void | Promise<void>,
): Promise<RuntimeOpenResolvedWorkspace> {
  const admission = workspaceAdmissionFromInput(input)
  const repoInput = admission.kind === 'workspace-entry' ? admission.entry.id : admission.input
  return await runWorkspaceRuntimeMembershipCommand(repoInput, async () => {
    const opened = await openLocalWorkspaceRuntimeForCommandInput(repoInput)
    await onOpened?.(opened)
    return opened
  })
}

async function openLocalWorkspaceRuntimeForCommandInput(repoInput: string): Promise<RuntimeOpenResolvedWorkspace> {
  const opened = await openWorkspaceRuntimeForInput(repoInput)
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
    input: repoInput,
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
    const currentRoots = Object.values(get().workspaces).map((workspace) => workspace.id)
    if (sameWorkspaceIdSet(currentRoots, capturedRecovery.declaredRepoRoots)) {
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
    declaredRepoRoots: WorkspaceId[]
    remoteEnsureTargets: Array<{ workspaceId: WorkspaceId; workspaceRuntimeId: string }>
  }
> {
  const captured = Object.values(get().workspaces).map((repo) => ({
    workspaceId: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
  }))
  const response = await reconcileWorkspaceRuntimeMemberships(captured.map((entry) => entry.workspaceId))
  const runtimeByRoot = new Map(response.runtimes.map((entry) => [entry.workspaceId, entry]))
  const changedTargets: SettledWorkspaceRuntimeMembershipRecovery['changedTargets'] = []

  set((state) => {
    let workspaces = state.workspaces
    for (const previous of captured) {
      const current = workspaces[previous.workspaceId]
      const runtime = runtimeByRoot.get(previous.workspaceId)
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
    declaredRepoRoots: captured.map((entry) => entry.workspaceId),
    remoteEnsureTargets: captured.flatMap(({ workspaceId }) => {
      const runtime = runtimeByRoot.get(workspaceId)
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

async function runWorkspaceRuntimeMembershipCommand<T>(repoKey: string, command: () => Promise<T>): Promise<T> {
  const precedingExclusive = workspaceRuntimeMembershipExclusiveTail
  let queue = workspaceRuntimeMembershipQueues.get(repoKey)
  if (!queue) {
    queue = new PQueue({ concurrency: 1 })
    workspaceRuntimeMembershipQueues.set(repoKey, queue)
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
      if (workspaceRuntimeMembershipQueues.get(repoKey) === queue && queue.size === 0 && queue.pending === 0) {
        workspaceRuntimeMembershipQueues.delete(repoKey)
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
  const selectedTerminalSessionIdByTerminalWorktree = { ...s.selectedTerminalSessionIdByTerminalWorktree }
  const tabOpenerIdentityByScope = { ...s.tabOpenerIdentityByScope }
  const navigationHistoryByWorkspace = { ...s.navigationHistoryByWorkspace }
  delete workspaces[id]
  delete navigationHistoryByWorkspace[id]
  for (const terminalWorktreeKey of Object.keys(selectedTerminalSessionIdByTerminalWorktree)) {
    if (terminalWorktreeKey.startsWith(`${id}\0`))
      delete selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey]
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
        selectedTerminalSessionIdByTerminalWorktree: Object.fromEntries(
          Object.entries(s.restoredClientWorkspaceBaseline.selectedTerminalSessionIdByTerminalWorktree).filter(
            ([key]) => !key.startsWith(`${id}\0`),
          ),
        ),
      }
    : null
  return {
    workspaces,
    selectedTerminalSessionIdByTerminalWorktree,
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

async function recordRecentWorkspacePostOpen(repo: WorkspaceSessionEntry): Promise<OpenWorkspacePostOpenError[]> {
  try {
    await recordRecentWorkspace(repo)
    return []
  } catch (err) {
    workspacesLog.warn('failed to record recent repo after opening workspace', { repo, err })
    return [
      { kind: 'recent-workspace', message: err instanceof Error ? err.message : 'workspace-picker.recent-save-failed' },
    ]
  }
}

/** Build a fresh repo by layering the restorable cache on top of an
 *  empty shell. `nameHints` is consulted in workspaceOrder; the first non-empty
 *  hint wins, then the cached name, then the last path segment of the
 *  id. The caller mutates lifecycle / availability fields before
 *  returning it from `upsertWorkspace.create`. */
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

function sessionProjectionStateForResolvedWorkspace(resolvedWorkspace: ResolvedWorkspace): WorkspaceSessionProjectionState {
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

/** Upsert a repo by id, centralising the "if it exists, mutate; if
 *  not, create + insert" pattern shared by addResolvedWorkspace,
 *  addUnavailableWorkspace, and insertPlaceholderWorkspace.
 *  - `create` runs when the id is new and returns the new repo.
 *  - `update`, when provided, runs against the existing repo and
 *    returns the updated state, or `null` to signal "no change". The
 *    returned `changed` is true exactly when the produced state
 *    differs from the input state — true for new workspaces, true for
 *    any in-place update that returns a non-null value, false when
 *    the existing repo was preserved (no-op or update returned null). */
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
  resolvedRepo: ResolvedWorkspace,
  workspaceRuntimeId: string,
  rankById?: ReadonlyMap<string, number>,
): Pick<WorkspacesStore, 'workspaces' | 'workspaceOrder'> & { changed: boolean; id: WorkspaceId } {
  return upsertWorkspace(s, resolvedRepo.id, {
    rankById,
    create: () => {
      const repo = buildNewWorkspace(s, resolvedRepo.id, [resolvedRepo.name], workspaceRuntimeId)
      repo.session = {
        entry: sessionEntryForResolvedWorkspace(resolvedRepo),
        projectionState: sessionProjectionStateForResolvedWorkspace(resolvedRepo),
      }
      // Local resolves carry no target, so `lifecycle` stays null
      // (emptyWorkspace's default). Remote resolves with a target settle
      // to 'ready'. The `addResolvedWorkspace` write path is only ever
      // reached for a remote entry with a target — the failure
      // branch in workspace runtime resolution calls addUnavailableWorkspace instead.
      if (resolvedRepo.workspaceProbe) acceptWorkspaceProbeState(repo, resolvedRepo.workspaceProbe)
      const restored = restoreRepoProjectionFromCacheEntry(repo, s.repoSnapshotCache[resolvedRepo.id])
      if (resolvedRepo.target) markRemoteLifecycleReady(restored, resolvedRepo.target)
      return restored
    },
    update: (existing) => {
      const hadGitProjection = existing.capability.kind === 'git'
      const runtimeChanged = existing.workspaceRuntimeId !== workspaceRuntimeId
      const preserveGitProjection = !runtimeChanged && hadGitProjection
      const nameChanged = resolvedRepo.name.length > 0 && existing.name !== resolvedRepo.name
      const sessionEntry = sessionEntryForResolvedWorkspace(resolvedRepo)
      const sessionProjectionState = sessionProjectionStateForResolvedWorkspace(resolvedRepo)
      const sessionChanged =
        existing.session.projectionState !== sessionProjectionState ||
        !sameWorkspaceSessionEntry(existing.session.entry, sessionEntry)
      const workspaceProbeChanged =
        !!resolvedRepo.workspaceProbe &&
        !sameWorkspaceProbeState(existing.capability.probe, resolvedRepo.workspaceProbe)
      if (!resolvedRepo.target) {
        if (!runtimeChanged && !nameChanged && !sessionChanged && !workspaceProbeChanged) return null
        const next: WorkspaceState = {
          ...existing,
          workspaceRuntimeId: runtimeChanged ? workspaceRuntimeId : existing.workspaceRuntimeId,
          name: nameChanged ? resolvedRepo.name : existing.name,
          session: {
            entry: sessionEntry,
            projectionState: sessionProjectionState,
          },
          capability: capabilityAcrossRuntimeTransition(existing, workspaceRuntimeId),
        }
        if (resolvedRepo.workspaceProbe) acceptWorkspaceProbeState(next, resolvedRepo.workspaceProbe)
        return preserveGitProjection
          ? next
          : restoreRepoProjectionFromCacheEntry(next, s.repoSnapshotCache[resolvedRepo.id])
      }
      const lifecycleReady = existing.admission.kind === 'remote' && existing.admission.lifecycle?.kind === 'ready'
      const targetChanged = !remoteTargetsEqual(
        existing.admission.kind === 'remote' ? remoteWorkspaceConnectionTarget(existing.admission.lifecycle) : null,
        resolvedRepo.target,
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
      // Promote the existing remote repo from 'connecting' or
      // 'failed' to 'ready' even when the retained target is the
      // same. The converged lifecycle result is authoritative; target
      // equality alone does not prove the repo is already ready.
      const next: WorkspaceState = {
        ...existing,
        workspaceRuntimeId: runtimeChanged ? workspaceRuntimeId : existing.workspaceRuntimeId,
        name: nameChanged ? resolvedRepo.name : existing.name,
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
      if (resolvedRepo.workspaceProbe) acceptWorkspaceProbeState(next, resolvedRepo.workspaceProbe)
      const restored = preserveGitProjection
        ? next
        : restoreRepoProjectionFromCacheEntry(next, s.repoSnapshotCache[resolvedRepo.id])
      markRemoteLifecycleReady(restored, resolvedRepo.target)
      return restored
    },
  })
}

/**
 * Mark a repo as unavailable. Two paths:
 *   - If the repo isn't in the store yet, insert it (e.g. ensureWorkspaceOpen
 *     got a probe failure back). Uses the restorable cache for any cached
 *     name/branches, then flips availability.
 *   - If a placeholder (from insertPlaceholderWorkspace) is already there, promote
 *     it in place. Capability authority is retained only while the runtime epoch
 *     is unchanged; a replacement runtime starts from probing before availability
 *     and transport admission settle.
 *     (The derived connectivity naturally reads as 'unreachable' once
 *     availability is unavailable.)
 */
export function addUnavailableWorkspace(
  s: Pick<WorkspacesStore, 'workspaces' | 'repoSnapshotCache' | 'workspaceOrder'>,
  id: WorkspaceId,
  reason: string,
  workspaceRuntimeId: string,
  target?: RemoteWorkspaceTarget,
  rankById?: ReadonlyMap<string, number>,
): Pick<WorkspacesStore, 'workspaces' | 'workspaceOrder'> & { changed: boolean; id: WorkspaceId } {
  return upsertWorkspace(s, id, {
    rankById,
    create: () => {
      const repo = buildNewWorkspace(s, id, [target?.displayName], workspaceRuntimeId)
      repo.session = {
        entry: target ? remoteWorkspaceSessionEntry(target) : repo.session.entry,
        projectionState: 'projected',
      }
      // New repo: write the failed lifecycle (with last-known target
      // if the probe got far enough to resolve one).
      if (repo.admission.kind === 'remote') markRemoteLifecycleFailed(repo, reason, target)
      else markRepoUnavailable(repo, reason)
      return repo
    },
    update: (existing) => {
      const runtimeChanged = existing.workspaceRuntimeId !== workspaceRuntimeId
      // Existing repo: refresh the failed lifecycle with the new
      // reason. Preserve the last-known target if the new failure
      // didn't pin down a fresh one — the user can still see the
      // remote locator on the failed repo. The remote slice MUST
      // be a fresh object — zustand's middleware freezes the
      // state tree, and markRemoteLifecycleFailed mutates the
      // passed repo's remote.
      const retainedTarget =
        target ??
        (existing.admission.kind === 'remote' ? remoteWorkspaceConnectionTarget(existing.admission.lifecycle) : null) ??
        undefined
      const next: WorkspaceState = {
        ...existing,
        workspaceRuntimeId: runtimeChanged ? workspaceRuntimeId : existing.workspaceRuntimeId,
        capability: capabilityAcrossRuntimeTransition(existing, workspaceRuntimeId),
        session: {
          entry: target ? remoteWorkspaceSessionEntry(target) : existing.session.entry,
          projectionState: 'projected',
        },
        admission:
          existing.admission.kind === 'remote'
            ? {
                kind: 'remote',
                lifecycle: existing.admission.lifecycle,
                lifecycleAttemptId: existing.admission.lifecycleAttemptId,
              }
            : existing.admission,
      }
      if (next.admission.kind === 'remote') markRemoteLifecycleFailed(next, reason, retainedTarget)
      else markRepoUnavailable(next, reason)
      return next
    },
  })
}

/**
 * Insert a placeholder repo for a session entry whose probe is still in
 * flight. The placeholder paints the cached branch projection (if any)
 * immediately; the derived connectivity naturally reads as 'connecting'
 * because no remote target has been resolved yet. The probe resolution
 * then promotes it to 'connected' or 'unreachable' via addResolvedWorkspace /
 * addUnavailableWorkspace. No-op if the workspace is already in the store (so
 * calling this twice for the same entry is safe).
 *
 * Note: the ref only carries alias/remotePath; host/user/port require
 * `resolveRemoteWorkspaceTarget`, which hasn't run yet. Until the probe
 * succeeds and addResolvedWorkspace fills in the target, the placeholder lives
 * in a "known alias, unknown concrete host" state —
 * `deriveConnectivity(repo) === 'connecting'` is the signal callers should
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
      const repo = buildNewWorkspace(s, entry.id, [fallbackName], workspaceRuntimeId)
      repo.session = {
        entry,
        projectionState: 'projected',
      }
      // Placeholders exist only to occupy the workspace switcher slot during a
      // remote-workspace lifecycle run. For a local placeholder the
      // lifecycle stays null (local workspaces don't have one); for a
      // remote placeholder we mark `connecting` so deriveConnectivity
      // can show the spinner until addResolvedWorkspace /
      // addUnavailableWorkspace replaces it.
      // A remote shell with no accepted server lifecycle renders as pending;
      // only the runtime projection may publish `connecting`.
      // 'refreshing' so the cached branches render with a stale indicator
      // (dataLoadInitialLoading would hide them).
      return repo
    },
  })
}

export function refreshInitialWorkspaceState(set: WorkspacesSet, get: WorkspacesGet, refresh: InitialWorkspaceRefresh) {
  const repo = get().workspaces[refresh.id]
  if (!repo || repo.workspaceRuntimeId !== refresh.workspaceRuntimeId) return
  if (repo.capability.kind !== 'git') return
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
      const repoInput = admission.kind === 'workspace-entry' ? admission.entry.id : admission.input
      return await runWorkspaceCommand(repoInput, async () => await openLocalWorkspace(set, get, repoInput))
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
  repoInput: string,
): Promise<OpenWorkspaceResult> {
  const initialRefreshRef: { current: InitialWorkspaceRefresh | null } = { current: null }
  const resolved = await runWorkspaceRuntimeMembershipCommand(repoInput, async () => {
    const opened = await openLocalWorkspaceRuntimeForCommandInput(repoInput)
    if (!opened.workspace || !opened.workspaceRuntimeId) return opened
    const workspace = opened.workspace
    const workspaceRuntimeId = opened.workspaceRuntimeId
    const workspaceEntry = workspace.target
      ? remoteWorkspaceSessionEntry(workspace.target)
      : { kind: 'local' as const, id: workspace.id }
    const membership = await addWorkspaceMembershipResult(workspaceEntry)
    if (!membership.ok) {
      workspacesLog.warn('failed to add local repo to server workspace', {
        workspaceId: workspace.id,
        err: membership.error,
      })
      await releaseUncommittedWorkspaceRuntime(workspace.id, workspaceRuntimeId)
      return { ...opened, reason: 'error.failed-read-repo', workspace: null, workspaceRuntimeId: null }
    }
    set((state) => {
      const { workspaces, workspaceOrder, changed } = addResolvedWorkspace(state, workspace, workspaceRuntimeId)
      if (changed)
        initialRefreshRef.current = { id: workspace.id, workspaceRuntimeId: workspaces[workspace.id]!.workspaceRuntimeId }
      return changed ? { workspaces, workspaceOrder } : state
    })
    return opened
  })
  if (!resolved.workspace || !resolved.workspaceRuntimeId) {
    return { ok: false, message: resolved.reason ?? 'error.repo-git-unavailable' }
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
      workspacesLog.warn('failed to add remote repo to server workspace', {
        workspaceId: entry.id,
        err: membership.error,
      })
      return null
    }
    return { workspaceRuntimeId }
  })
  if (!prepared) return { ok: false, message: 'error.failed-read-repo' }

  const outcome = await runRemoteWorkspaceConnection(set, get, entry.id, {
    workspaceRuntimeId: prepared.workspaceRuntimeId,
  })
  if (get().workspaces[entry.id]?.workspaceRuntimeId !== prepared.workspaceRuntimeId) {
    return { ok: false, message: 'error.failed-read-repo' }
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
  if (!workspace) return { ok: false, message: 'error.failed-read-repo' }
  const workspaceRuntimeId = workspace.workspaceRuntimeId
  const membership = await removeWorkspaceMembershipResult(workspaceId)
  if (!membership.ok) {
    workspacesLog.warn('failed to remove workspace from server session', { workspaceId, err: membership.error })
    return { ok: false, message: 'error.failed-read-repo' }
  }
  disposeRepoOperationScheduler(workspaceId)
  void abortRepoOperation(workspaceId).catch(() => {})
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
