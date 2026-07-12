import { lastPathSegment } from '#/web/lib/paths.ts'
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
  closeRepoRuntime,
  openRepoRuntimeForInput,
  openRepoRuntime,
  probeRepo,
  reconcileRepoRuntimeMemberships,
} from '#/web/repo-client.ts'
import { resolveRemoteRepositoryTarget } from '#/web/remote-client.ts'
import { recordRecentRepo } from '#/web/settings-actions.ts'
import {
  invalidateRepoRuntimes,
  removeRepoRuntimeFromCache,
  refreshRepoRuntimes,
  replaceRepoRuntimeCache,
  updateRepoRuntimeCache,
} from '#/web/repo-runtime-query.ts'
import { clearWorkspacePaneTabsProjectionState } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { reposLog } from '#/web/logger.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { runRemoteRepoConnection } from '#/web/stores/repos/remote-repo-connection-command.ts'
import { acceptRemoteLifecycleSnapshot } from '#/web/stores/repos/remote-lifecycle-projection.ts'
import { emptyRepoOperations } from '#/web/stores/repos/operations.ts'
import {
  markRemoteLifecycleFailed,
  markRemoteLifecycleReady,
} from '#/web/stores/repos/availability.ts'
import type {
  OpenRepoPostOpenError,
  OpenRepoResult,
  ReposGet,
  ReposSet,
  RepoState,
  ReposStore,
} from '#/web/stores/repos/types.ts'
import { nextRestoredRepoIdAfterWorkspaceClose } from '#/web/open-workspace-state.ts'
import {
  isRemoteRepoId,
  localRepoSessionEntry,
  normalizeRemoteRepoRef,
  parseRemoteRepoId,
  remoteRepoConnectionTarget,
  remoteRepoSessionEntry,
  type RemoteRepoTarget,
  type RepoSessionEntry,
} from '#/shared/remote-repo.ts'

interface ResolvedRepo {
  id: string
  name: string
  target?: RemoteRepoTarget
}

interface ProbeResult {
  input: string
  reason: string | null
  repo: ResolvedRepo | null
  target?: RemoteRepoTarget
}

export interface RuntimeOpenResolvedRepo {
  input: string
  reason: string | null
  repo: ResolvedRepo | null
  repoRuntimeId: string | null
}

const repoRuntimeMembershipQueues = new Map<string, PQueue>()
const activeRepoRuntimeMembershipCommands = new Set<Promise<unknown>>()
let repoRuntimeMembershipExclusiveTail: Promise<void> = Promise.resolve()

export interface InitialRepoRefresh {
  id: string
  repoRuntimeId: string
}

function sessionEntryFromInput(input: string | RepoSessionEntry): RepoSessionEntry {
  if (typeof input !== 'string') return input
  if (!isRemoteRepoId(input)) return localRepoSessionEntry(input)
  const parsed = parseRemoteRepoId(input)
  const ref = parsed ? normalizeRemoteRepoRef(parsed) : null
  return ref ? { kind: 'remote', id: ref.id, ref } : localRepoSessionEntry(input)
}

export async function resolveRepoPath(
  input: string | RepoSessionEntry,
  onError?: (err: unknown) => void,
  fallbackError = 'error.failed-read-repo',
): Promise<ProbeResult> {
  const entry = sessionEntryFromInput(input)
  try {
    let target: RemoteRepoTarget | undefined
    if (entry.kind === 'remote') target = await resolveRemoteRepositoryTarget(entry.ref)
    const probe = await probeRepo(entry.id)
    if (!probe?.ok || !probe.root) {
      return {
        input: entry.id,
        reason: probe?.message ?? 'error.not-git-repo',
        repo: null,
        target,
      }
    }
    return {
      input: entry.id,
      reason: null,
      repo: {
        id: probe.root,
        name: probe.name ?? (entry.kind === 'remote' ? entry.ref.displayName : lastPathSegment(probe.root)),
        ...(target ? { target } : {}),
      },
      target,
    }
  } catch (err) {
    onError?.(err)
    return {
      input: entry.id,
      reason: err instanceof Error ? err.message : fallbackError,
      repo: null,
    }
  }
}

export async function openLocalRepoRuntimeForInput(
  input: string | RepoSessionEntry,
  onOpened?: (opened: RuntimeOpenResolvedRepo) => void | Promise<void>,
): Promise<RuntimeOpenResolvedRepo> {
  const entry = sessionEntryFromInput(input)
  return await runRepoRuntimeMembershipCommand(entry.id, async () => {
    const opened = await openLocalRepoRuntimeForEntry(entry)
    await onOpened?.(opened)
    return opened
  })
}

async function openLocalRepoRuntimeForEntry(entry: RepoSessionEntry): Promise<RuntimeOpenResolvedRepo> {
  const opened = await openRepoRuntimeForInput(entry.id)
  if (!opened.ok) {
    return {
      input: opened.input,
      reason: opened.reason,
      repo: null,
      repoRuntimeId: null,
    }
  }
  await updateRepoRuntimeCache({ repoRoot: opened.repo.id, repoRuntimeId: opened.repoRuntimeId })
  return {
    input: entry.id,
    reason: null,
    repo: opened.repo,
    repoRuntimeId: opened.repoRuntimeId,
  }
}

export async function openRepoRuntimeWithCache(
  repoRoot: string,
  onOpened?: (repoRuntimeId: string) => void | Promise<void>,
): Promise<string> {
  return await runRepoRuntimeMembershipCommand(repoRoot, async () => {
    const repoRuntimeId = await openRepoRuntime(repoRoot)
    await updateRepoRuntimeCache({ repoRoot, repoRuntimeId })
    await onOpened?.(repoRuntimeId)
    return repoRuntimeId
  })
}

export async function closeRepoRuntimeWithCache(repoRoot: string, repoRuntimeId: string): Promise<void> {
  await runRepoRuntimeMembershipCommand(repoRoot, async () => {
    try {
      const released = await closeRepoRuntime(repoRoot, repoRuntimeId)
      if (released) await removeRepoRuntimeFromCache({ repoRoot, repoRuntimeId })
      else await refreshRepoRuntimes()
    } catch (err) {
      await refreshRepoRuntimes()
      throw err
    } finally {
      clearWorkspacePaneTabsProjectionState(repoRoot, repoRuntimeId)
    }
  })
}

export type RepoRuntimeMembershipRecoveryResult =
  | {
      kind: 'settled'
      targets: Array<{ repoRoot: string; repoRuntimeId: string }>
      changedTargets: Array<{ repoRoot: string; previousRepoRuntimeId: string; repoRuntimeId: string }>
    }
  | { kind: 'superseded' }

type SettledRepoRuntimeMembershipRecovery = Extract<RepoRuntimeMembershipRecoveryResult, { kind: 'settled' }>
type ReconciledRepoRuntimeMembershipRecovery = RepoRuntimeMembershipRecoveryResult & {
  remoteEnsureTargets?: Array<{ repoRoot: string; repoRuntimeId: string }>
}

/**
 * Re-declares this window's complete repo membership after realtime recovery,
 * then atomically advances every still-current local shell to the server's
 * canonical runtime epoch.
 */
export async function reconcileOpenRepoRuntimeMemberships(
  set: ReposSet,
  get: ReposGet,
): Promise<RepoRuntimeMembershipRecoveryResult> {
  const recovery = await runExclusiveRepoRuntimeMembershipCommand(
    async () => await reconcileOpenRepoRuntimeMembershipsNow(set, get),
  )
  if (recovery.kind === 'superseded') return recovery
  void Promise.all(
    (recovery.remoteEnsureTargets ?? []).map(async (target) => {
      await runRemoteRepoConnection(set, get, target.repoRoot, {
        repoRuntimeId: target.repoRuntimeId,
        mode: 'ensure',
      })
    }),
  ).catch((err) => {
    reposLog.warn('failed to ensure remote lifecycle after runtime membership recovery', { err })
  })
  return { kind: 'settled', targets: recovery.targets, changedTargets: recovery.changedTargets }
}

async function reconcileOpenRepoRuntimeMembershipsNow(
  set: ReposSet,
  get: ReposGet,
): Promise<ReconciledRepoRuntimeMembershipRecovery> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const capturedRecovery = await reconcileCapturedRepoRuntimeMemberships(set, get)
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

async function reconcileCapturedRepoRuntimeMemberships(
  set: ReposSet,
  get: ReposGet,
): Promise<SettledRepoRuntimeMembershipRecovery & {
  declaredRepoRoots: string[]
  remoteEnsureTargets: Array<{ repoRoot: string; repoRuntimeId: string }>
}> {
  const captured = Object.values(get().repos).map((repo) => ({
    repoRoot: repo.id,
    repoRuntimeId: repo.repoRuntimeId,
  }))
  const response = await reconcileRepoRuntimeMemberships(captured.map((entry) => entry.repoRoot))
  const runtimeByRoot = new Map(response.runtimes.map((entry) => [entry.repoRoot, entry]))
  const changedTargets: SettledRepoRuntimeMembershipRecovery['changedTargets'] = []

  set((state) => {
    let repos = state.repos
    for (const previous of captured) {
      const current = repos[previous.repoRoot]
      const runtime = runtimeByRoot.get(previous.repoRoot)
      if (!current || current.repoRuntimeId !== previous.repoRuntimeId || !runtime) continue
      if (runtime.repoRuntimeId === previous.repoRuntimeId) continue
      if (repos === state.repos) repos = { ...state.repos }
      repos[previous.repoRoot] = repoShellForNewRuntimeEpoch(current, runtime.repoRuntimeId)
      changedTargets.push({
        repoRoot: previous.repoRoot,
        previousRepoRuntimeId: previous.repoRuntimeId,
        repoRuntimeId: runtime.repoRuntimeId,
      })
    }
    return repos === state.repos ? state : { ...state, repos }
  })

  for (const changed of changedTargets) {
    disposeRepoOperationScheduler(changed.repoRoot)
    clearWorkspacePaneTabsProjectionState(changed.repoRoot, changed.previousRepoRuntimeId)
    primaryWindowQueryClient.removeQueries({
      queryKey: ['repo-data', changed.repoRoot, changed.previousRepoRuntimeId],
    })
  }
  await replaceRepoRuntimeCache({ runtimes: response.runtimes })
  acceptRemoteLifecycleSnapshot(set, get, { runtimes: response.runtimes })

  return {
    kind: 'settled',
    targets: captured.flatMap(({ repoRoot }) => {
      const repoRuntimeId = get().repos[repoRoot]?.repoRuntimeId
      return repoRuntimeId ? [{ repoRoot, repoRuntimeId }] : []
    }),
    changedTargets,
    declaredRepoRoots: captured.map((entry) => entry.repoRoot),
    remoteEnsureTargets: captured.flatMap(({ repoRoot }) => {
      const runtime = runtimeByRoot.get(repoRoot)
      const currentRepoRuntimeId = get().repos[repoRoot]?.repoRuntimeId
      if (
        !runtime ||
        !isRemoteRepoId(repoRoot) ||
        currentRepoRuntimeId !== runtime.repoRuntimeId ||
        !['idle', 'connecting'].includes(runtime.remoteLifecycle?.kind ?? '')
      ) {
        return []
      }
      return [{ repoRoot, repoRuntimeId: runtime.repoRuntimeId }]
    }),
  }
}

function sameRepoRootSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((repoRoot) => rightSet.has(repoRoot))
}

function repoShellForNewRuntimeEpoch(repo: RepoState, repoRuntimeId: string): RepoState {
  return {
    ...repo,
    repoRuntimeId,
    dataLoads: {
      repoReadModel: { phase: 'idle', loadedAt: repo.dataLoads.repoReadModel.loadedAt, error: null, stale: true },
      visibleStatus: { phase: 'idle', loadedAt: repo.dataLoads.visibleStatus.loadedAt, error: null, stale: true },
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

async function runRepoRuntimeMembershipCommand<T>(repoKey: string, command: () => Promise<T>): Promise<T> {
  const precedingExclusive = repoRuntimeMembershipExclusiveTail
  let queue = repoRuntimeMembershipQueues.get(repoKey)
  if (!queue) {
    queue = new PQueue({ concurrency: 1 })
    repoRuntimeMembershipQueues.set(repoKey, queue)
  }
  const work = (async () => {
    await precedingExclusive
    return await queue.add(command)
  })()
  activeRepoRuntimeMembershipCommands.add(work)
  try {
    return await work
  } finally {
    activeRepoRuntimeMembershipCommands.delete(work)
    void queue.onIdle().then(() => {
      if (repoRuntimeMembershipQueues.get(repoKey) === queue && queue.size === 0 && queue.pending === 0) {
        repoRuntimeMembershipQueues.delete(repoKey)
      }
    })
  }
}

async function runExclusiveRepoRuntimeMembershipCommand<T>(command: () => Promise<T>): Promise<T> {
  const precedingExclusive = repoRuntimeMembershipExclusiveTail
  const precedingShared = Array.from(activeRepoRuntimeMembershipCommands)
  const work = (async () => {
    await precedingExclusive
    await Promise.allSettled(precedingShared)
    return await command()
  })()
  repoRuntimeMembershipExclusiveTail = work.then(
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
  return {
    repos,
    selectedTerminalSessionIdByTerminalWorktree,
    tabOpenerIdentityByScope,
    navigationHistoryByRepo,
    order,
    restoredRepoId,
  }
}

async function recordRecentRepoPostOpen(repo: RepoSessionEntry): Promise<OpenRepoPostOpenError[]> {
  try {
    await recordRecentRepo(repo)
    return []
  } catch (err) {
    reposLog.warn('failed to record recent repo after opening workspace', { repo, err })
    return [{ kind: 'recent-repo', message: err instanceof Error ? err.message : 'repo-picker.recent-save-failed' }]
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
  repoRuntimeId: string,
): RepoState {
  const cached = s.repoSnapshotCache[id]
  const hint = nameHints.find((value): value is string => !!value)
  const name = hint ?? cached?.name ?? lastPathSegment(id)
  seedRepoProjectionQueryFromCacheEntry(id, repoRuntimeId, cached)
  const repo = restoreRepoProjectionFromCacheEntry(emptyRepo(id, name, repoRuntimeId), cached)
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
  repoRuntimeId: string,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean; id: string } {
  return upsertRepo(s, resolvedRepo.id, {
    rankById,
    create: () => {
      const repo = buildNewRepo(s, resolvedRepo.id, [resolvedRepo.name], repoRuntimeId)
      // Local resolves carry no target, so `lifecycle` stays null
      // (emptyRepo's default). Remote resolves with a target settle
      // to 'ready'. The `addResolvedRepo` write path is only ever
      // reached for a remote entry with a target — the failure
      // branch in resolveRepoPath calls addUnavailableRepo instead.
      if (resolvedRepo.target) markRemoteLifecycleReady(repo, resolvedRepo.target)
      return repo
    },
    update: (existing) => {
      const runtimeChanged = existing.repoRuntimeId !== repoRuntimeId
      const nameChanged = resolvedRepo.name.length > 0 && existing.name !== resolvedRepo.name
      if (!resolvedRepo.target) {
        if (!runtimeChanged) return null
        return {
          ...existing,
          repoRuntimeId,
        }
      }
      const lifecycleReady = existing.remote.lifecycle?.kind === 'ready'
      const targetChanged = !remoteTargetsEqual(
        remoteRepoConnectionTarget(existing.remote.lifecycle),
        resolvedRepo.target,
      )
      if (!runtimeChanged && !nameChanged && lifecycleReady && !targetChanged) return null
      // Promote the existing remote repo from 'connecting' or
      // 'failed' to 'ready' even when the retained target is the
      // same. The converged lifecycle result is authoritative; target
      // equality alone does not prove the repo is already ready.
      const next: RepoState = {
        ...existing,
        repoRuntimeId: runtimeChanged ? repoRuntimeId : existing.repoRuntimeId,
        name: nameChanged ? resolvedRepo.name : existing.name,
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
  repoRuntimeId: string,
  target?: RemoteRepoTarget,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean; id: string } {
  return upsertRepo(s, id, {
    rankById,
    create: () => {
      const repo = buildNewRepo(s, id, [target?.displayName], repoRuntimeId)
      // New repo: write the failed lifecycle (with last-known target
      // if the probe got far enough to resolve one).
      markRemoteLifecycleFailed(repo, reason, target)
      return repo
    },
    update: (existing) => {
      const runtimeChanged = existing.repoRuntimeId !== repoRuntimeId
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
        repoRuntimeId: runtimeChanged ? repoRuntimeId : existing.repoRuntimeId,
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
  entry: RepoSessionEntry,
  repoRuntimeId: string,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean; id: string } {
  return upsertRepo(s, entry.id, {
    rankById,
    create: () => {
      const fallbackName = entry.kind === 'remote' ? entry.ref.displayName : null
      const repo = buildNewRepo(s, entry.id, [fallbackName], repoRuntimeId)
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
        repo.dataLoads.repoReadModel = { ...repo.dataLoads.repoReadModel, phase: 'refreshing', error: null, stale: true }
      }
      return repo
    },
  })
}

export function refreshInitialRepoState(set: ReposSet, get: ReposGet, refresh: InitialRepoRefresh) {
  const repo = get().repos[refresh.id]
  if (!repo || repo.repoRuntimeId !== refresh.repoRuntimeId) return
  void requestRepoProjectionReadModelRefresh({ get, set }, refresh.id, { repoRuntimeId: refresh.repoRuntimeId })
}

export function createRuntimeRepoSessionActions(
  set: ReposSet,
  get: ReposGet,
): Pick<ReposStore, 'ensureWorkspaceOpen' | 'closeRepo' | 'retryRemoteRepoConnection'> {
  return {
    async ensureWorkspaceOpen(pathOrEntry: string | RepoSessionEntry): Promise<OpenRepoResult> {
      const entry = sessionEntryFromInput(pathOrEntry)
      // Remote entries submit one server-owned lifecycle command; this caller
      // only translates its canonical outcome into OpenRepoResult.
      if (isRemoteRepoId(entry.id)) {
        // Pre-insert the window-local shell before applying the server result.
        if (!get().repos[entry.id]) {
          await openRepoRuntimeWithCache(entry.id, (repoRuntimeId) => {
            set((s) => {
              const result = insertPlaceholderRepo(
                { repos: s.repos, repoSnapshotCache: s.repoSnapshotCache, order: s.order },
                entry,
                repoRuntimeId,
              )
              return { ...s, repos: result.repos, order: result.order }
            })
          })
        }
        const outcome = await runRemoteRepoConnection(set, get, entry.id)
        if (!outcome) return { ok: false, message: 'error.not-git-repo' }
        if (
          outcome.kind === 'superseded' ||
          outcome.kind === 'stale-runtime' ||
          outcome.kind === 'cancelled' ||
          outcome.kind === 'transport-failed'
        ) {
          return { ok: false, message: 'error.failed-read-repo' }
        }
        if (outcome.kind === 'ready') {
          const recentEntry = remoteRepoSessionEntry(outcome.target)
          return { ok: true, id: outcome.repoId, postOpenEffects: recordRecentRepoPostOpen(recentEntry) }
        }
        return { ok: false, message: outcome.reason ?? 'error.failed-read-repo' }
      }
      // Local repos use the direct runtime-open path — there's no remote
      // lifecycle command to converge.
      let initialRefresh: InitialRepoRefresh | null = null
      const resolved = await openLocalRepoRuntimeForInput(entry, (opened) => {
        if (!opened.repo || !opened.repoRuntimeId) return
        const repo = opened.repo
        const repoRuntimeId = opened.repoRuntimeId
        set((s) => {
          const { repos, order, changed } = addResolvedRepo(s, repo, repoRuntimeId)
          if (changed) initialRefresh = { id: repo.id, repoRuntimeId: repos[repo.id]!.repoRuntimeId }
          return changed ? { repos, order } : s
        })
      })
      if (!resolved.repo || !resolved.repoRuntimeId)
        return { ok: false, message: resolved.reason ?? 'error.not-git-repo' }
      const repo = resolved.repo
      const { id } = repo
      const recentEntry = repo.target ? remoteRepoSessionEntry(repo.target) : { kind: 'local' as const, id }

      if (initialRefresh) refreshInitialRepoState(set, get, initialRefresh)
      return { ok: true, id, postOpenEffects: recordRecentRepoPostOpen(recentEntry) }
    },

    closeRepo(id: string) {
      const repoRuntimeId = get().repos[id]?.repoRuntimeId ?? null
      disposeRepoOperationScheduler(id)
      // Tell main to abort any cancellable network op for this repo —
      // otherwise a `git push` started right before the user closed the
      // repo keeps running for up to the network timeout, charged to a
      // repo that no longer exists. Fire-and-forget; failure is fine.
      void abortRepoOperation(id).catch(() => {
        /* main may have nothing to abort — ignore */
      })
      set((s) => removeRepoFromSessionState(s, id))
      if (typeof repoRuntimeId === 'string') {
        void closeRepoRuntimeWithCache(id, repoRuntimeId).catch((err) => {
          reposLog.warn('failed to close repo runtime', { id, repoRuntimeId, err })
          void invalidateRepoRuntimes().catch((refreshErr) => {
            reposLog.warn('failed to refresh repo runtime membership after close failure', {
              id,
              repoRuntimeId,
              err: refreshErr,
            })
          })
        })
      }
    },

    async retryRemoteRepoConnection(id: string) {
      if (!isRemoteRepoId(id)) return null
      const outcome = await runRemoteRepoConnection(set, get, id)
      if (!outcome) return null
      if (outcome.kind === 'superseded' || outcome.kind === 'stale-runtime' || outcome.kind === 'cancelled') return null
      if (outcome.kind === 'transport-failed') return { ok: false, reason: outcome.reason }
      if (outcome.kind === 'ready') return { ok: true }
      return { ok: false, reason: outcome.reason ?? 'unknown' }
    },
  }
}
