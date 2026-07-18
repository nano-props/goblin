import { lastPathSegment } from '#/web/lib/paths.ts'
import { recordWithoutKey } from '#/shared/record.ts'
import PQueue from 'p-queue'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import {
  restoreRepoProjectionFromCacheEntry,
  seedRepoProjectionQueryFromCacheEntry,
} from '#/web/stores/repos/persistence.ts'
import { disposeRepoOperationScheduler } from '#/web/stores/repos/repo-operation-scheduler.ts'
import { requestRepoProjectionReadModelRefresh } from '#/web/stores/repos/refresh.ts'
import {
  abortRepoOperation,
  probeRepo,
} from '#/web/repo-client.ts'
import {
  closeWorkspaceRuntime,
  openWorkspaceRuntime,
  openWorkspaceRuntimeForInput,
  reconcileWorkspaceRuntimeMemberships,
} from '#/web/workspace-client.ts'
import { resolveRemoteRepositoryTarget } from '#/web/remote-client.ts'
import { addRepoToWorkspace, recordRecentWorkspace, removeRepoFromWorkspace } from '#/web/settings-actions.ts'
import {
  invalidateWorkspaceRuntimes,
  removeWorkspaceRuntimeFromCache,
  refreshWorkspaceRuntimes,
  replaceWorkspaceRuntimeCache,
  updateWorkspaceRuntimeCache,
} from '#/web/workspace-runtime-query.ts'
import { clearWorkspacePaneTabsProjectionState } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { reposLog } from '#/web/logger.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { runRemoteWorkspaceConnection } from '#/web/stores/repos/remote-workspace-connection-command.ts'
import { acceptRemoteLifecycleSnapshot } from '#/web/stores/repos/remote-lifecycle-projection.ts'
import { emptyRepoOperations } from '#/web/stores/repos/operations.ts'
import { markRemoteLifecycleFailed, markRemoteLifecycleReady } from '#/web/stores/repos/availability.ts'
import type {
  CloseWorkspaceResult,
  OpenWorkspacePostOpenError,
  OpenWorkspaceResult,
  RepoSessionProjectionState,
  ReposGet,
  ReposSet,
  RepoState,
  ReposStore,
} from '#/web/stores/repos/types.ts'
import { nextRestoredRepoIdAfterWorkspaceClose } from '#/web/open-workspace-state.ts'
import {
  isRemoteRepoId,
  localWorkspaceSessionEntry,
  normalizeRemoteRepoRef,
  parseRemoteRepoId,
  remoteRepoConnectionTarget,
  remoteWorkspaceSessionEntry,
  sameWorkspaceSessionEntry,
  type RemoteRepoTarget,
  type WorkspaceSessionEntry,
} from '#/shared/remote-repo.ts'
import { sameWorkspaceProbeState, type WorkspaceProbeState } from '#/shared/workspace-runtime.ts'

interface ResolvedRepo {
  id: string
  name: string
  target?: RemoteRepoTarget
  workspaceProbe?: WorkspaceProbeState
  session?: {
    entry: WorkspaceSessionEntry
    projectionState: RepoSessionProjectionState
  }
}

interface ProbeResult {
  input: string
  reason: string | null
  repo: ResolvedRepo | null
  target?: RemoteRepoTarget
}

export interface RuntimeOpenResolvedWorkspace {
  input: string
  reason: string | null
  repo: ResolvedRepo | null
  workspaceRuntimeId: string | null
  workspaceProbe?: WorkspaceProbeState
}

const workspaceRuntimeMembershipQueues = new Map<string, PQueue>()
const workspaceRepoCommandQueues = new Map<string, PQueue>()
const activeWorkspaceRuntimeMembershipCommands = new Set<Promise<unknown>>()
let workspaceRuntimeMembershipExclusiveTail: Promise<void> = Promise.resolve()

export interface InitialRepoRefresh {
  id: string
  workspaceRuntimeId: string
}

type WorkspaceAdmissionInput =
  { kind: 'command-input'; input: string } | { kind: 'workspace-entry'; entry: WorkspaceSessionEntry }

function workspaceAdmissionFromInput(input: string | WorkspaceSessionEntry): WorkspaceAdmissionInput {
  if (typeof input !== 'string') return { kind: 'workspace-entry', entry: input }
  if (!isRemoteRepoId(input)) return { kind: 'command-input', input }
  const parsed = parseRemoteRepoId(input)
  const ref = parsed ? normalizeRemoteRepoRef(parsed) : null
  return ref
    ? { kind: 'workspace-entry', entry: { kind: 'remote', id: ref.id, ref } }
    : { kind: 'command-input', input }
}

export async function resolveRepoPath(
  input: string | WorkspaceSessionEntry,
  onError?: (err: unknown) => void,
  fallbackError = 'error.failed-read-repo',
): Promise<ProbeResult> {
  const admission = workspaceAdmissionFromInput(input)
  const value = admission.kind === 'workspace-entry' ? admission.entry : admission.input
  try {
    let target: RemoteRepoTarget | undefined
    if (typeof value !== 'string' && value.kind === 'remote') target = await resolveRemoteRepositoryTarget(value.ref)
    const repoInput = typeof value === 'string' ? value : value.id
    const probe = await probeRepo(repoInput)
    if (!probe?.ok || !probe.root) {
      return {
        input: repoInput,
        reason: probe?.message ?? 'error.repo-git-unavailable',
        repo: null,
        target,
      }
    }
    return {
      input: repoInput,
      reason: null,
      repo: {
        id: probe.root,
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
      repo: null,
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
      repo: null,
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
    repo: { ...opened.workspace, workspaceProbe },
    workspaceRuntimeId: opened.workspaceRuntimeId,
    workspaceProbe,
  }
}

export async function openWorkspaceRuntimeWithCache(
  workspaceId: string,
  onOpened?: (workspaceRuntimeId: string) => void | Promise<void>,
): Promise<string> {
  return await runWorkspaceRuntimeMembershipCommand(workspaceId, async () => {
    const workspaceRuntimeId = await openWorkspaceRuntime(workspaceId)
    await updateWorkspaceRuntimeCache({ workspaceId, workspaceRuntimeId })
    await onOpened?.(workspaceRuntimeId)
    return workspaceRuntimeId
  })
}

export async function closeWorkspaceRuntimeWithCache(workspaceId: string, workspaceRuntimeId: string): Promise<void> {
  await runWorkspaceRuntimeMembershipCommand(workspaceId, async () => {
    await closeWorkspaceRuntimeWithCacheNow(workspaceId, workspaceRuntimeId)
  })
}

async function closeWorkspaceRuntimeWithCacheNow(workspaceId: string, workspaceRuntimeId: string): Promise<void> {
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
      targets: Array<{ workspaceId: string; workspaceRuntimeId: string }>
      changedTargets: Array<{ workspaceId: string; previousWorkspaceRuntimeId: string; workspaceRuntimeId: string }>
    }
  | { kind: 'superseded' }

type SettledWorkspaceRuntimeMembershipRecovery = Extract<WorkspaceRuntimeMembershipRecoveryResult, { kind: 'settled' }>
type ReconciledWorkspaceRuntimeMembershipRecovery = WorkspaceRuntimeMembershipRecoveryResult & {
  remoteEnsureTargets?: Array<{ workspaceId: string; workspaceRuntimeId: string }>
}

/**
 * Re-declares this window's complete repo membership after realtime recovery,
 * then atomically advances every still-current local shell to the server's
 * canonical runtime epoch.
 */
export async function reconcileOpenWorkspaceRuntimeMemberships(
  set: ReposSet,
  get: ReposGet,
): Promise<WorkspaceRuntimeMembershipRecoveryResult> {
  const recovery = await runExclusiveWorkspaceRuntimeMembershipCommand(
    async () => await reconcileOpenWorkspaceRuntimeMembershipsNow(set, get),
  )
  if (recovery.kind === 'superseded') return recovery
  void Promise.all(
    (recovery.remoteEnsureTargets ?? []).map(async (target) => {
      const workspaceId = canonicalWorkspaceLocator(target.workspaceId)
      if (!workspaceId) return
      await runRemoteWorkspaceConnection(set, get, workspaceId, {
        workspaceRuntimeId: target.workspaceRuntimeId,
        mode: 'ensure',
      })
    }),
  ).catch((err) => {
    reposLog.warn('failed to ensure remote lifecycle after runtime membership recovery', { err })
  })
  return { kind: 'settled', targets: recovery.targets, changedTargets: recovery.changedTargets }
}

async function reconcileOpenWorkspaceRuntimeMembershipsNow(
  set: ReposSet,
  get: ReposGet,
): Promise<ReconciledWorkspaceRuntimeMembershipRecovery> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const capturedRecovery = await reconcileCapturedWorkspaceRuntimeMemberships(set, get)
    const currentRoots = Object.keys(get().repos)
    if (sameRepoRootSet(currentRoots, capturedRecovery.declaredRepoRoots)) {
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
  set: ReposSet,
  get: ReposGet,
): Promise<
  SettledWorkspaceRuntimeMembershipRecovery & {
    declaredRepoRoots: string[]
    remoteEnsureTargets: Array<{ workspaceId: string; workspaceRuntimeId: string }>
  }
> {
  const captured = Object.values(get().repos).map((repo) => ({
    workspaceId: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
  }))
  const response = await reconcileWorkspaceRuntimeMemberships(captured.map((entry) => entry.workspaceId))
  const runtimeByRoot = new Map(response.runtimes.map((entry) => [entry.workspaceId, entry]))
  const changedTargets: SettledWorkspaceRuntimeMembershipRecovery['changedTargets'] = []

  set((state) => {
    let repos = state.repos
    for (const previous of captured) {
      const current = repos[previous.workspaceId]
      const runtime = runtimeByRoot.get(previous.workspaceId)
      if (!current || current.workspaceRuntimeId !== previous.workspaceRuntimeId || !runtime) continue
      if (runtime.workspaceRuntimeId === previous.workspaceRuntimeId) continue
      if (repos === state.repos) repos = { ...state.repos }
      repos[previous.workspaceId] = repoShellForNewRuntimeEpoch(current, runtime.workspaceRuntimeId)
      changedTargets.push({
        workspaceId: previous.workspaceId,
        previousWorkspaceRuntimeId: previous.workspaceRuntimeId,
        workspaceRuntimeId: runtime.workspaceRuntimeId,
      })
    }
    return repos === state.repos ? state : { ...state, repos }
  })

  for (const changed of changedTargets) {
    disposeRepoOperationScheduler(changed.workspaceId)
    clearWorkspacePaneTabsProjectionState(changed.workspaceId, changed.previousWorkspaceRuntimeId)
    primaryWindowQueryClient.removeQueries({
      queryKey: ['repo-data', changed.workspaceId, changed.previousWorkspaceRuntimeId],
    })
  }
  await replaceWorkspaceRuntimeCache({ runtimes: response.runtimes })
  acceptRemoteLifecycleSnapshot(set, get, { runtimes: response.runtimes })

  return {
    kind: 'settled',
    targets: captured.flatMap(({ workspaceId }) => {
      const workspaceRuntimeId = get().repos[workspaceId]?.workspaceRuntimeId
      return workspaceRuntimeId ? [{ workspaceId, workspaceRuntimeId }] : []
    }),
    changedTargets,
    declaredRepoRoots: captured.map((entry) => entry.workspaceId),
    remoteEnsureTargets: captured.flatMap(({ workspaceId }) => {
      const runtime = runtimeByRoot.get(workspaceId)
      const currentWorkspaceRuntimeId = get().repos[workspaceId]?.workspaceRuntimeId
      if (
        !runtime ||
        !isRemoteRepoId(workspaceId) ||
        currentWorkspaceRuntimeId !== runtime.workspaceRuntimeId ||
        !['idle', 'connecting'].includes(runtime.remoteLifecycle?.kind ?? '')
      ) {
        return []
      }
      return [{ workspaceId, workspaceRuntimeId: runtime.workspaceRuntimeId }]
    }),
  }
}

function sameRepoRootSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((repoRoot) => rightSet.has(repoRoot))
}

function repoShellForNewRuntimeEpoch(repo: RepoState, workspaceRuntimeId: string): RepoState {
  return {
    ...repo,
    workspaceRuntimeId,
    dataLoads: {
      repoReadModel: { phase: 'idle', loadedAt: repo.dataLoads.repoReadModel.loadedAt, error: null, stale: true },
      fetch: { phase: 'idle', loadedAt: null, error: null, stale: false },
    },
    operations: emptyRepoOperations(),
    remote: {
      ...repo.remote,
      lifecycle: null,
      lifecycleAttemptId: null,
      fetchFailed: false,
      fetchError: null,
    },
    events: [],
  }
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

async function runWorkspaceCommand<T>(repoKey: string, command: () => Promise<T>): Promise<T> {
  let queue = workspaceRepoCommandQueues.get(repoKey)
  if (!queue) {
    queue = new PQueue({ concurrency: 1 })
    workspaceRepoCommandQueues.set(repoKey, queue)
  }
  try {
    return await queue.add(command)
  } finally {
    void queue.onIdle().then(() => {
      if (workspaceRepoCommandQueues.get(repoKey) === queue && queue.size === 0 && queue.pending === 0) {
        workspaceRepoCommandQueues.delete(repoKey)
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

function orderedInsert(order: string[], id: string, rankById?: ReadonlyMap<string, number>): string[] {
  if (!rankById) return [...order, id]
  const rank = rankById.get(id)
  if (rank === undefined) return [...order, id]
  const next = [...order]
  const index = next.findIndex((existing) => {
    const existingRank = rankById.get(existing)
    return existingRank !== undefined && existingRank > rank
  })
  next.splice(index === -1 ? next.length : index, 0, id)
  return next
}

function removeRepoFromSessionState(s: ReposStore, id: string): Partial<ReposStore> {
  if (!s.repos[id]) return s
  const repos = { ...s.repos }
  const selectedTerminalSessionIdByTerminalWorktree = { ...s.selectedTerminalSessionIdByTerminalWorktree }
  const tabOpenerIdentityByScope = { ...s.tabOpenerIdentityByScope }
  const navigationHistoryByRepo = { ...s.navigationHistoryByRepo }
  delete repos[id]
  delete navigationHistoryByRepo[id]
  for (const terminalWorktreeKey of Object.keys(selectedTerminalSessionIdByTerminalWorktree)) {
    if (terminalWorktreeKey.startsWith(`${id}\0`))
      delete selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey]
  }
  for (const scopeKey of Object.keys(tabOpenerIdentityByScope)) {
    if (scopeKey.startsWith(`${id}\0`)) delete tabOpenerIdentityByScope[scopeKey]
  }
  const order = s.order.filter((x) => x !== id)
  const restoredRepoId = nextRestoredRepoIdAfterWorkspaceClose(s.order, s.restoredRepoId, id)
  const restoredClientWorkspaceBaseline = s.restoredClientWorkspaceBaseline
    ? {
        ...s.restoredClientWorkspaceBaseline,
        preferredWorkspacePaneTabByTargetByRepo: recordWithoutKey(
          s.restoredClientWorkspaceBaseline.preferredWorkspacePaneTabByTargetByRepo,
          id,
        ),
        filetreeViewStateByWorktreeByRepo: recordWithoutKey(
          s.restoredClientWorkspaceBaseline.filetreeViewStateByWorktreeByRepo,
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
    repos,
    selectedTerminalSessionIdByTerminalWorktree,
    tabOpenerIdentityByScope,
    navigationHistoryByRepo,
    order,
    restoredRepoId,
    restoredClientWorkspaceBaseline,
  }
}

async function rollbackNewWorkspaceRepo(
  set: ReposSet,
  get: ReposGet,
  workspaceId: string,
  workspaceRuntimeId: string,
): Promise<void> {
  if (get().repos[workspaceId]?.workspaceRuntimeId !== workspaceRuntimeId) return
  disposeRepoOperationScheduler(workspaceId)
  set((state) =>
    state.repos[workspaceId]?.workspaceRuntimeId === workspaceRuntimeId
      ? removeRepoFromSessionState(state, workspaceId)
      : state,
  )
  try {
    await closeWorkspaceRuntimeWithCache(workspaceId, workspaceRuntimeId)
  } catch (err) {
    reposLog.warn('failed to release workspace runtime after workspace membership write failed', {
      workspaceId,
      workspaceRuntimeId,
      err,
    })
    try {
      await invalidateWorkspaceRuntimes()
    } catch (refreshErr) {
      reposLog.warn('failed to refresh workspace runtimes after workspace open rollback', {
        workspaceId,
        workspaceRuntimeId,
        err: refreshErr,
      })
    }
  }
}

type WorkspaceMembershipWriteResult = { ok: true } | { ok: false; error: unknown }

async function addWorkspaceRepoResult(entry: WorkspaceSessionEntry): Promise<WorkspaceMembershipWriteResult> {
  try {
    await addRepoToWorkspace(entry)
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

async function removeWorkspaceRepoResult(workspaceId: string): Promise<WorkspaceMembershipWriteResult> {
  try {
    await removeRepoFromWorkspace(workspaceId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

async function releaseUncommittedWorkspaceRuntime(workspaceId: string, workspaceRuntimeId: string): Promise<void> {
  try {
    await closeWorkspaceRuntimeWithCacheNow(workspaceId, workspaceRuntimeId)
  } catch (err) {
    reposLog.warn('failed to release uncommitted workspace runtime', { workspaceId, workspaceRuntimeId, err })
  }
}

async function recordRecentWorkspacePostOpen(repo: WorkspaceSessionEntry): Promise<OpenWorkspacePostOpenError[]> {
  try {
    await recordRecentWorkspace(repo)
    return []
  } catch (err) {
    reposLog.warn('failed to record recent repo after opening workspace', { repo, err })
    return [{ kind: 'recent-workspace', message: err instanceof Error ? err.message : 'workspace-picker.recent-save-failed' }]
  }
}

/** Build a fresh repo by layering the restorable cache on top of an
 *  empty shell. `nameHints` is consulted in order; the first non-empty
 *  hint wins, then the cached name, then the last path segment of the
 *  id. The caller mutates lifecycle / availability fields before
 *  returning it from `upsertRepo.create`. */
function buildNewRepo(
  s: Pick<ReposStore, 'repoSnapshotCache'>,
  id: string,
  nameHints: ReadonlyArray<string | undefined | null>,
  workspaceRuntimeId: string,
): RepoState {
  const cached = s.repoSnapshotCache[id]
  const hint = nameHints.find((value): value is string => !!value)
  const name = hint ?? cached?.name ?? lastPathSegment(id)
  seedRepoProjectionQueryFromCacheEntry(id, workspaceRuntimeId, cached)
  const repo = restoreRepoProjectionFromCacheEntry(emptyRepo(id, name, workspaceRuntimeId), cached)
  return hint ? { ...repo, name: hint } : repo
}

function remoteTargetsEqual(a: RemoteRepoTarget | undefined | null, b: RemoteRepoTarget | undefined): boolean {
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

function sessionEntryForResolvedRepo(resolvedRepo: ResolvedRepo): WorkspaceSessionEntry {
  return (
    resolvedRepo.session?.entry ??
    (resolvedRepo.target
      ? remoteWorkspaceSessionEntry(resolvedRepo.target)
      : localWorkspaceSessionEntry(resolvedRepo.id))
  )
}

function sessionProjectionStateForResolvedRepo(resolvedRepo: ResolvedRepo): RepoSessionProjectionState {
  return resolvedRepo.session?.projectionState ?? 'projected'
}

/** Upsert a repo by id, centralising the "if it exists, mutate; if
 *  not, create + insert" pattern shared by addResolvedRepo,
 *  addUnavailableRepo, and insertPlaceholderRepo.
 *  - `create` runs when the id is new and returns the new repo.
 *  - `update`, when provided, runs against the existing repo and
 *    returns the updated state, or `null` to signal "no change". The
 *    returned `changed` is true exactly when the produced state
 *    differs from the input state — true for new repos, true for
 *    any in-place update that returns a non-null value, false when
 *    the existing repo was preserved (no-op or update returned null). */
function upsertRepo(
  s: Pick<ReposStore, 'repos' | 'repoSnapshotCache' | 'order'>,
  id: string,
  options: {
    rankById?: ReadonlyMap<string, number>
    create: () => RepoState
    update?: (existing: RepoState) => RepoState | null
  },
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean; id: string } {
  const existing = s.repos[id]
  if (existing) {
    if (!options.update) return { repos: s.repos, order: s.order, changed: false, id }
    const updated = options.update(existing)
    if (!updated) return { repos: s.repos, order: s.order, changed: false, id }
    return {
      repos: { ...s.repos, [id]: updated },
      order: s.order,
      changed: true,
      id,
    }
  }
  return {
    repos: { ...s.repos, [id]: options.create() },
    order: orderedInsert(s.order, id, options.rankById),
    changed: true,
    id,
  }
}

export function addResolvedRepo(
  s: Pick<ReposStore, 'repos' | 'repoSnapshotCache' | 'order'>,
  resolvedRepo: ResolvedRepo,
  workspaceRuntimeId: string,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean; id: string } {
  return upsertRepo(s, resolvedRepo.id, {
    rankById,
    create: () => {
      const repo = buildNewRepo(s, resolvedRepo.id, [resolvedRepo.name], workspaceRuntimeId)
      repo.session = {
        entry: sessionEntryForResolvedRepo(resolvedRepo),
        projectionState: sessionProjectionStateForResolvedRepo(resolvedRepo),
      }
      // Local resolves carry no target, so `lifecycle` stays null
      // (emptyRepo's default). Remote resolves with a target settle
      // to 'ready'. The `addResolvedRepo` write path is only ever
      // reached for a remote entry with a target — the failure
      // branch in resolveRepoPath calls addUnavailableRepo instead.
      if (resolvedRepo.target) markRemoteLifecycleReady(repo, resolvedRepo.target)
      if (resolvedRepo.workspaceProbe) repo.workspaceProbe = resolvedRepo.workspaceProbe
      return repo
    },
    update: (existing) => {
      const runtimeChanged = existing.workspaceRuntimeId !== workspaceRuntimeId
      const nameChanged = resolvedRepo.name.length > 0 && existing.name !== resolvedRepo.name
      const sessionEntry = sessionEntryForResolvedRepo(resolvedRepo)
      const sessionProjectionState = sessionProjectionStateForResolvedRepo(resolvedRepo)
      const sessionChanged =
        existing.session.projectionState !== sessionProjectionState ||
        !sameWorkspaceSessionEntry(existing.session.entry, sessionEntry)
      const workspaceProbeChanged =
        !!resolvedRepo.workspaceProbe && !sameWorkspaceProbeState(existing.workspaceProbe, resolvedRepo.workspaceProbe)
      if (!resolvedRepo.target) {
        if (!runtimeChanged && !nameChanged && !sessionChanged && !workspaceProbeChanged) return null
        return {
          ...existing,
          workspaceRuntimeId: runtimeChanged ? workspaceRuntimeId : existing.workspaceRuntimeId,
          name: nameChanged ? resolvedRepo.name : existing.name,
          session: {
            entry: sessionEntry,
            projectionState: sessionProjectionState,
          },
          workspaceProbe: resolvedRepo.workspaceProbe ?? existing.workspaceProbe,
        }
      }
      const lifecycleReady = existing.remote.lifecycle?.kind === 'ready'
      const targetChanged = !remoteTargetsEqual(
        remoteRepoConnectionTarget(existing.remote.lifecycle),
        resolvedRepo.target,
      )
      if (!runtimeChanged && !nameChanged && !sessionChanged && lifecycleReady && !targetChanged) return null
      // Promote the existing remote repo from 'connecting' or
      // 'failed' to 'ready' even when the retained target is the
      // same. The converged lifecycle result is authoritative; target
      // equality alone does not prove the repo is already ready.
      const next: RepoState = {
        ...existing,
        workspaceRuntimeId: runtimeChanged ? workspaceRuntimeId : existing.workspaceRuntimeId,
        name: nameChanged ? resolvedRepo.name : existing.name,
        session: {
          entry: sessionEntry,
          projectionState: sessionProjectionState,
        },
        remote: { ...existing.remote },
      }
      markRemoteLifecycleReady(next, resolvedRepo.target)
      return next
    },
  })
}

/**
 * Mark a repo as unavailable. Two paths:
 *   - If the repo isn't in the store yet, insert it (e.g. ensureWorkspaceOpen
 *     got a probe failure back). Uses the restorable cache for any cached
 *     name/branches, then flips availability.
 *   - If a placeholder (from insertPlaceholderRepo) is already there, promote
 *     it in place — preserves the cached projection, updates target if
 *     the probe produced one, and flips availability to 'unavailable'.
 *     (The derived connectivity naturally reads as 'unreachable' once
 *     availability is unavailable.)
 */
export function addUnavailableRepo(
  s: Pick<ReposStore, 'repos' | 'repoSnapshotCache' | 'order'>,
  id: string,
  reason: string,
  workspaceRuntimeId: string,
  target?: RemoteRepoTarget,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean; id: string } {
  return upsertRepo(s, id, {
    rankById,
    create: () => {
      const repo = buildNewRepo(s, id, [target?.displayName], workspaceRuntimeId)
      repo.session = {
        entry: target ? remoteWorkspaceSessionEntry(target) : repo.session.entry,
        projectionState: 'projected',
      }
      // New repo: write the failed lifecycle (with last-known target
      // if the probe got far enough to resolve one).
      markRemoteLifecycleFailed(repo, reason, target)
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
      const retainedTarget = target ?? remoteRepoConnectionTarget(existing.remote.lifecycle) ?? undefined
      const next: RepoState = {
        ...existing,
        workspaceRuntimeId: runtimeChanged ? workspaceRuntimeId : existing.workspaceRuntimeId,
        session: {
          entry: target ? remoteWorkspaceSessionEntry(target) : existing.session.entry,
          projectionState: 'projected',
        },
        remote: { ...existing.remote },
      }
      markRemoteLifecycleFailed(next, reason, retainedTarget)
      return next
    },
  })
}

/**
 * Insert a placeholder repo for a session entry whose probe is still in
 * flight. The placeholder paints the cached branch projection (if any)
 * immediately; the derived connectivity naturally reads as 'connecting'
 * because no remote target has been resolved yet. The probe resolution
 * then promotes it to 'connected' or 'unreachable' via addResolvedRepo /
 * addUnavailableRepo. No-op if the repo is already in the store (so
 * calling this twice for the same entry is safe).
 *
 * Note: the ref only carries alias/remotePath; host/user/port require
 * `resolveRemoteRepositoryTarget`, which hasn't run yet. Until the probe
 * succeeds and addResolvedRepo fills in the target, the placeholder lives
 * in a "known alias, unknown concrete host" state —
 * `deriveConnectivity(repo) === 'connecting'` is the signal callers should
 * branch on rather than reading target fields.
 */
export function insertPlaceholderRepo(
  s: Pick<ReposStore, 'repos' | 'repoSnapshotCache' | 'order'>,
  entry: WorkspaceSessionEntry,
  workspaceRuntimeId: string,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean; id: string } {
  return upsertRepo(s, entry.id, {
    rankById,
    create: () => {
      const fallbackName = entry.kind === 'remote' ? entry.ref.displayName : null
      const repo = buildNewRepo(s, entry.id, [fallbackName], workspaceRuntimeId)
      repo.session = {
        entry,
        projectionState: 'projected',
      }
      // Placeholders exist only to occupy the repo switcher slot during a
      // remote-repo lifecycle run. For a local placeholder the
      // lifecycle stays null (local repos don't have one); for a
      // remote placeholder we mark `connecting` so deriveConnectivity
      // can show the spinner until addResolvedRepo /
      // addUnavailableRepo replaces it.
      // A remote shell with no accepted server lifecycle renders as pending;
      // only the runtime projection may publish `connecting`.
      // 'refreshing' so the cached branches render with a stale indicator
      // (dataLoadInitialLoading would hide them).
      const cached = s.repoSnapshotCache[entry.id]
      if (cached && cached.data.branches.length > 0) {
        repo.dataLoads.repoReadModel = {
          ...repo.dataLoads.repoReadModel,
          phase: 'refreshing',
          error: null,
          stale: true,
        }
      }
      return repo
    },
  })
}

export function refreshInitialRepoState(set: ReposSet, get: ReposGet, refresh: InitialRepoRefresh) {
  const repo = get().repos[refresh.id]
  if (!repo || repo.workspaceRuntimeId !== refresh.workspaceRuntimeId) return
  if (repo.workspaceProbe.status === 'ready' && repo.workspaceProbe.capabilities.git.status === 'unavailable') return
  void requestRepoProjectionReadModelRefresh({ get, set }, refresh.id, { workspaceRuntimeId: refresh.workspaceRuntimeId })
}

export function createWorkspaceSessionActions(
  set: ReposSet,
  get: ReposGet,
): Pick<ReposStore, 'ensureWorkspaceOpen' | 'closeWorkspace' | 'retryRemoteWorkspaceConnection'> {
  return {
    async ensureWorkspaceOpen(pathOrEntry: string | WorkspaceSessionEntry): Promise<OpenWorkspaceResult> {
      const admission = workspaceAdmissionFromInput(pathOrEntry)
      if (admission.kind === 'workspace-entry' && admission.entry.kind === 'remote') {
        return await openRemoteWorkspace(set, get, admission.entry)
      }
      const repoInput = admission.kind === 'workspace-entry' ? admission.entry.id : admission.input
      return await runWorkspaceCommand(repoInput, async () => await openLocalWorkspace(set, get, repoInput))
    },

    async closeWorkspace(id: string): Promise<CloseWorkspaceResult> {
      return await runWorkspaceCommand(id, async () => await closeWorkspaceMembership(set, get, id))
    },

    async retryRemoteWorkspaceConnection(id: string) {
      if (!isRemoteRepoId(id)) return null
      const workspaceId = canonicalWorkspaceLocator(id)
      if (!workspaceId) return null
      const outcome = await runRemoteWorkspaceConnection(set, get, workspaceId)
      if (!outcome) return null
      if (outcome.kind === 'superseded' || outcome.kind === 'stale-runtime' || outcome.kind === 'cancelled') return null
      if (outcome.kind === 'transport-failed') return { ok: false, reason: outcome.reason }
      if (outcome.kind === 'ready') return { ok: true }
      return { ok: false, reason: outcome.reason ?? 'unknown' }
    },
  }
}

async function openLocalWorkspace(set: ReposSet, get: ReposGet, repoInput: string): Promise<OpenWorkspaceResult> {
  const initialRefreshRef: { current: InitialRepoRefresh | null } = { current: null }
  const resolved = await runWorkspaceRuntimeMembershipCommand(repoInput, async () => {
    const opened = await openLocalWorkspaceRuntimeForCommandInput(repoInput)
    if (!opened.repo || !opened.workspaceRuntimeId) return opened
    const repo = opened.repo
    const workspaceRuntimeId = opened.workspaceRuntimeId
    const workspaceEntry = repo.target
      ? remoteWorkspaceSessionEntry(repo.target)
      : { kind: 'local' as const, id: repo.id }
    const membership = await addWorkspaceRepoResult(workspaceEntry)
    if (!membership.ok) {
      reposLog.warn('failed to add local repo to server workspace', { workspaceId: repo.id, err: membership.error })
      await releaseUncommittedWorkspaceRuntime(repo.id, workspaceRuntimeId)
      return { ...opened, reason: 'error.failed-read-repo', repo: null, workspaceRuntimeId: null }
    }
    set((state) => {
      const { repos, order, changed } = addResolvedRepo(state, repo, workspaceRuntimeId)
      if (changed) initialRefreshRef.current = { id: repo.id, workspaceRuntimeId: repos[repo.id]!.workspaceRuntimeId }
      return changed ? { repos, order } : state
    })
    return opened
  })
  if (!resolved.repo || !resolved.workspaceRuntimeId) {
    return { ok: false, message: resolved.reason ?? 'error.repo-git-unavailable' }
  }
  const workspaceId = canonicalWorkspaceLocator(resolved.repo.id)
  if (!workspaceId) return { ok: false, message: 'error.failed-read-repo' }
  if (initialRefreshRef.current) refreshInitialRepoState(set, get, initialRefreshRef.current)
  const recentEntry = resolved.repo.target
    ? remoteWorkspaceSessionEntry(resolved.repo.target)
    : { kind: 'local' as const, id: resolved.repo.id }
  return { ok: true, workspaceId, postOpenEffects: recordRecentWorkspacePostOpen(recentEntry) }
}

async function openRemoteWorkspace(
  set: ReposSet,
  get: ReposGet,
  entry: WorkspaceSessionEntry,
): Promise<OpenWorkspaceResult> {
  const prepared = await runWorkspaceCommand(entry.id, async () => {
    let openedWorkspaceRuntimeId: string | null = null
    if (!get().repos[entry.id]) {
      await openWorkspaceRuntimeWithCache(entry.id, (workspaceRuntimeId) => {
        openedWorkspaceRuntimeId = workspaceRuntimeId
        set((state) => {
          const result = insertPlaceholderRepo(
            { repos: state.repos, repoSnapshotCache: state.repoSnapshotCache, order: state.order },
            entry,
            workspaceRuntimeId,
          )
          return { ...state, repos: result.repos, order: result.order }
        })
      })
    }
    const workspaceRuntimeId = get().repos[entry.id]?.workspaceRuntimeId ?? null
    if (!workspaceRuntimeId) return null
    const membership = await addWorkspaceRepoResult(entry)
    if (!membership.ok) {
      if (openedWorkspaceRuntimeId) await rollbackNewWorkspaceRepo(set, get, entry.id, openedWorkspaceRuntimeId)
      reposLog.warn('failed to add remote repo to server workspace', { workspaceId: entry.id, err: membership.error })
      return null
    }
    return { workspaceRuntimeId }
  })
  if (!prepared) return { ok: false, message: 'error.failed-read-repo' }

  const workspaceId = canonicalWorkspaceLocator(entry.id)
  if (!workspaceId) return { ok: false, message: 'error.failed-read-repo' }
  const outcome = await runRemoteWorkspaceConnection(set, get, workspaceId, {
    workspaceRuntimeId: prepared.workspaceRuntimeId,
  })
  if (get().repos[entry.id]?.workspaceRuntimeId !== prepared.workspaceRuntimeId) {
    return { ok: false, message: 'error.failed-read-repo' }
  }
  const recentEntry = outcome?.kind === 'ready' ? remoteWorkspaceSessionEntry(outcome.target) : entry
  return { ok: true, workspaceId, postOpenEffects: recordRecentWorkspacePostOpen(recentEntry) }
}

async function closeWorkspaceMembership(set: ReposSet, get: ReposGet, id: string): Promise<CloseWorkspaceResult> {
  const workspaceRuntimeId = get().repos[id]?.workspaceRuntimeId ?? null
  const membership = await removeWorkspaceRepoResult(id)
  if (!membership.ok) {
    reposLog.warn('failed to remove repo from server workspace', { id, err: membership.error })
    return { ok: false, message: 'error.failed-read-repo' }
  }
  disposeRepoOperationScheduler(id)
  void abortRepoOperation(id).catch(() => {})
  set((state) => removeRepoFromSessionState(state, id))
  if (workspaceRuntimeId) {
    try {
      await closeWorkspaceRuntimeWithCache(id, workspaceRuntimeId)
    } catch (err) {
      reposLog.warn('failed to close workspace runtime', { id, workspaceRuntimeId, err })
      void invalidateWorkspaceRuntimes().catch((refreshErr) => {
        reposLog.warn('failed to refresh workspace runtime membership after close failure', {
          id,
          workspaceRuntimeId,
          err: refreshErr,
        })
      })
    }
  }
  return { ok: true }
}
