import { lastPathSegment } from '#/web/lib/paths.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { restoreRepoProjectionFromCacheEntry } from '#/web/stores/repos/persistence.ts'
import { disposeRepoOperationScheduler } from '#/web/stores/repos/repo-operation-scheduler.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
import {
  abortRepoOperation,
  closeRepoRuntimeInstance,
  openRepoRuntimeForInput,
  openRepoRuntimeInstance,
  probeRepo,
} from '#/web/repo-client.ts'
import { resolveRemoteRepositoryTarget } from '#/web/remote-client.ts'
import { recordRecentRepo } from '#/web/settings-actions.ts'
import {
  invalidateRepoRuntimeInstances,
  removeRepoRuntimeInstanceFromCache,
  updateRepoRuntimeInstanceCache,
} from '#/web/repo-runtime-query.ts'
import { clearWorkspacePaneTabsProjectionState } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { runRemoteRepoConnection } from '#/web/stores/repos/remote-repo-connection-orchestrator.ts'
import {
  markRemoteLifecycleConnecting,
  markRemoteLifecycleFailed,
  markRemoteLifecycleReady,
} from '#/web/stores/repos/availability.ts'
import type { OpenRepoResult, ReposGet, ReposSet, RepoState, ReposStore } from '#/web/stores/repos/types.ts'
import { nextActiveRepoIdAfterWorkspaceClose } from '#/web/open-workspace-state.ts'
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
  repoInstanceId: string | null
}

export interface InitialRepoRefresh {
  id: string
  repoInstanceId: string
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

export async function openLocalRepoRuntimeForInput(input: string | RepoSessionEntry): Promise<RuntimeOpenResolvedRepo> {
  const entry = sessionEntryFromInput(input)
  const opened = await openRepoRuntimeForInput(entry.id)
  if (!opened.ok) {
    return {
      input: opened.input,
      reason: opened.reason,
      repo: null,
      repoInstanceId: null,
    }
  }
  updateRepoRuntimeInstanceCache({ repoRoot: opened.repo.id, repoInstanceId: opened.repoInstanceId })
  return {
    input: entry.id,
    reason: null,
    repo: opened.repo,
    repoInstanceId: opened.repoInstanceId,
  }
}

export async function openRepoRuntimeInstanceWithCache(repoRoot: string): Promise<string> {
  const repoInstanceId = await openRepoRuntimeInstance(repoRoot)
  updateRepoRuntimeInstanceCache({ repoRoot, repoInstanceId })
  return repoInstanceId
}

export async function closeRepoRuntimeInstanceWithCache(repoRoot: string, repoInstanceId: string): Promise<void> {
  try {
    const closed = await closeRepoRuntimeInstance(repoRoot, repoInstanceId)
    if (closed) removeRepoRuntimeInstanceFromCache({ repoRoot, repoInstanceId })
    else invalidateRepoRuntimeInstances()
  } catch (err) {
    invalidateRepoRuntimeInstances()
    throw err
  } finally {
    clearWorkspacePaneTabsProjectionState(repoRoot, repoInstanceId)
  }
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

/** Build a fresh repo by layering the restorable cache on top of an
 *  empty shell. `nameHints` is consulted in order; the first non-empty
 *  hint wins, then the cached name, then the last path segment of the
 *  id. The caller mutates lifecycle / availability fields before
 *  returning it from `upsertRepo.create`. */
function buildNewRepo(
  s: Pick<ReposStore, 'repoSnapshotCache'>,
  id: string,
  nameHints: ReadonlyArray<string | undefined | null>,
  instanceId: string,
): RepoState {
  const cached = s.repoSnapshotCache[id]
  const hint = nameHints.find((value): value is string => !!value)
  const name = hint ?? cached?.name ?? lastPathSegment(id)
  const repo = restoreRepoProjectionFromCacheEntry(emptyRepo(id, name, instanceId), cached)
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
  instanceId: string,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean; id: string } {
  return upsertRepo(s, resolvedRepo.id, {
    rankById,
    create: () => {
      const repo = buildNewRepo(s, resolvedRepo.id, [resolvedRepo.name], instanceId)
      // Local resolves carry no target, so `lifecycle` stays null
      // (emptyRepo's default). Remote resolves with a target settle
      // to 'ready'. The `addResolvedRepo` write path is only ever
      // reached for a remote entry with a target — the failure
      // branch in resolveRepoPath calls addUnavailableRepo instead.
      if (resolvedRepo.target) markRemoteLifecycleReady(repo, resolvedRepo.target)
      return repo
    },
    update: (existing) => {
      const instanceChanged = existing.instanceId !== instanceId
      const nameChanged = resolvedRepo.name.length > 0 && existing.name !== resolvedRepo.name
      if (!resolvedRepo.target) {
        if (!instanceChanged) return null
        return {
          ...existing,
          instanceId,
        }
      }
      const lifecycleReady = existing.remote.lifecycle?.kind === 'ready'
      const targetChanged = !remoteTargetsEqual(
        remoteRepoConnectionTarget(existing.remote.lifecycle),
        resolvedRepo.target,
      )
      if (!instanceChanged && !nameChanged && lifecycleReady && !targetChanged) return null
      // Promote the existing remote repo from 'connecting' or
      // 'failed' to 'ready' even when the retained target is the
      // same. The converged lifecycle result is authoritative; target
      // equality alone does not prove the repo is already ready.
      const next: RepoState = {
        ...existing,
        instanceId: instanceChanged ? instanceId : existing.instanceId,
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
  instanceId: string,
  target?: RemoteRepoTarget,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean; id: string } {
  return upsertRepo(s, id, {
    rankById,
    create: () => {
      const repo = buildNewRepo(s, id, [target?.displayName], instanceId)
      // New repo: write the failed lifecycle (with last-known target
      // if the probe got far enough to resolve one).
      markRemoteLifecycleFailed(repo, reason, target)
      return repo
    },
    update: (existing) => {
      const instanceChanged = existing.instanceId !== instanceId
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
        instanceId: instanceChanged ? instanceId : existing.instanceId,
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
  instanceId: string,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean; id: string } {
  return upsertRepo(s, entry.id, {
    rankById,
    create: () => {
      const fallbackName = entry.kind === 'remote' ? entry.ref.displayName : null
      const repo = buildNewRepo(s, entry.id, [fallbackName], instanceId)
      // Placeholders exist only to occupy the repo switcher slot during a
      // remote-repo lifecycle run. For a local placeholder the
      // lifecycle stays null (local repos don't have one); for a
      // remote placeholder we mark `connecting` so deriveConnectivity
      // can show the spinner until addResolvedRepo /
      // addUnavailableRepo replaces it.
      if (entry.kind === 'remote') markRemoteLifecycleConnecting(repo)
      // 'refreshing' so the cached branches render with a stale indicator
      // (dataLoadInitialLoading would hide them).
      const cached = s.repoSnapshotCache[entry.id]
      if (cached && cached.data.branches.length > 0) {
        repo.dataLoads.snapshot = { ...repo.dataLoads.snapshot, phase: 'refreshing', error: null, stale: true }
      }
      return repo
    },
  })
}

export function refreshInitialRepoState(get: ReposGet, refresh: InitialRepoRefresh) {
  const repo = get().repos[refresh.id]
  if (!repo || repo.instanceId !== refresh.repoInstanceId) return
  void runRepoRefreshIntent(get, {
    kind: 'core-data-changed',
    reason: 'initial-load',
    id: refresh.id,
    repoInstanceId: refresh.repoInstanceId,
  })
}

export function createRuntimeRepoSessionActions(
  set: ReposSet,
  get: ReposGet,
): Pick<ReposStore, 'ensureWorkspaceOpen' | 'closeRepo' | 'retryRemoteRepoConnection'> {
  return {
    async ensureWorkspaceOpen(pathOrEntry: string | RepoSessionEntry): Promise<OpenRepoResult> {
      const entry = sessionEntryFromInput(pathOrEntry)
      // Remote entries go through the unified orchestrator. It
      // owns the connecting → ready/failed transition and the
      // initial refresh kickoff, so this caller only has to
      // translate the outcome into the OpenRepoResult contract.
      if (isRemoteRepoId(entry.id)) {
        // Per docs/.../plan §6.3 the orchestrator expects the repo
        // shell to exist already. Pre-insert the placeholder so
        // the orchestrator's "set connecting" lands on a real
        // store entry; the orchestrator will fill in target +
        // trigger refresh on settle.
        if (!get().repos[entry.id]) {
          const instanceId = await openRepoRuntimeInstanceWithCache(entry.id)
          set((s) => {
            const result = insertPlaceholderRepo(
              { repos: s.repos, repoSnapshotCache: s.repoSnapshotCache, order: s.order },
              entry,
              instanceId,
            )
            return { ...s, repos: result.repos, order: result.order }
          })
        }
        const outcome = await runRemoteRepoConnection(set, get, entry.id)
        if (!outcome) return { ok: false, message: 'error.not-git-repo' }
        if (outcome.kind === 'ready' && outcome.target) {
          const recentEntry = remoteRepoSessionEntry(outcome.target)
          void recordRecentRepo(recentEntry).catch(() => {
            /* recent menu is best-effort */
          })
          return { ok: true, id: outcome.repoId }
        }
        return { ok: false, message: outcome.reason ?? 'error.failed-read-repo' }
      }
      // Local repos use the direct runtime-open path — there's no remote
      // lifecycle to converge and no orchestrator concern.
      const resolved = await openLocalRepoRuntimeForInput(entry)
      if (!resolved.repo || !resolved.repoInstanceId)
        return { ok: false, message: resolved.reason ?? 'error.not-git-repo' }
      const repo = resolved.repo
      const { id } = repo
      const instanceId = resolved.repoInstanceId
      let initialRefresh: InitialRepoRefresh | null = null
      const recentEntry = repo.target ? remoteRepoSessionEntry(repo.target) : { kind: 'local' as const, id }
      void recordRecentRepo(recentEntry).catch(() => {
        /* recent menu is best-effort */
      })

      set((s) => {
        const { repos, order, changed } = addResolvedRepo(s, repo, instanceId)
        // Only kick off an initial refresh when the resolved probe
        // actually changed the store (new repo, or existing placeholder
        // got a new target). A matching target is a no-op set and the
        // cached data is already coherent — re-running the snapshot/
        // status pipeline would just duplicate the in-flight work.
        if (changed) initialRefresh = { id, repoInstanceId: repos[id]!.instanceId }
        return changed ? { repos, order } : s
      })

      if (initialRefresh) refreshInitialRepoState(get, initialRefresh)
      return { ok: true, id }
    },

    closeRepo(id: string) {
      const repoInstanceId = get().repos[id]?.instanceId ?? null
      disposeRepoOperationScheduler(id)
      // Tell main to abort any cancellable network op for this repo —
      // otherwise a `git push` started right before the user closed the
      // repo keeps running for up to the network timeout, charged to a
      // repo that no longer exists. Fire-and-forget; failure is fine.
      void abortRepoOperation(id).catch(() => {
        /* main may have nothing to abort — ignore */
      })
      set((s) => {
        if (!s.repos[id]) return s
        const repos = { ...s.repos }
        const selectedTerminalSessionIdByTerminalWorktree = { ...s.selectedTerminalSessionIdByTerminalWorktree }
        const tabOpenerIdentityByScope = { ...s.tabOpenerIdentityByScope }
        delete repos[id]
        for (const terminalWorktreeKey of Object.keys(selectedTerminalSessionIdByTerminalWorktree)) {
          if (terminalWorktreeKey.startsWith(`${id}\0`))
            delete selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey]
        }
        for (const scopeKey of Object.keys(tabOpenerIdentityByScope)) {
          if (scopeKey.startsWith(`${id}\0`)) delete tabOpenerIdentityByScope[scopeKey]
        }
        const order = s.order.filter((x) => x !== id)
        const activeId = nextActiveRepoIdAfterWorkspaceClose(s.order, s.activeId, id)
        return {
          repos,
          selectedTerminalSessionIdByTerminalWorktree,
          tabOpenerIdentityByScope,
          order,
          activeId,
        }
      })
      if (typeof repoInstanceId === 'string') {
        void closeRepoRuntimeInstanceWithCache(id, repoInstanceId).catch(() => {
          invalidateRepoRuntimeInstances()
        })
      }
    },

    async retryRemoteRepoConnection(id: string) {
      if (!isRemoteRepoId(id)) return null
      const outcome = await runRemoteRepoConnection(set, get, id)
      if (!outcome) return null
      if (outcome.kind === 'ready') return { ok: true }
      return { ok: false, reason: outcome.reason ?? 'unknown' }
    },
  }
}
