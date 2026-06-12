import { lastPathSegment } from '#/web/lib/paths.ts'
import { emptyRepo } from '#/web/stores/repos/helpers.ts'
import { restoreRepoProjectionFromSnapshot } from '#/web/stores/repos/persistence.ts'
import { disposeRepoRuntime } from '#/web/stores/repos/runtime.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
import { abortRepositoryOperation, probeRepository } from '#/web/repo-client.ts'
import { resolveRemoteRepositoryTarget } from '#/web/remote-client.ts'
import { recordRecentRepo } from '#/web/settings-write-paths.ts'
import type { OpenRepoResult, ReposGet, ReposSet, ReposStore } from '#/web/stores/repos/types.ts'
import { nextActiveRepoIdAfterWorkspaceClose } from '#/web/open-workspace-state.ts'
import {
  isRemoteRepoId,
  localRepoSessionEntry,
  normalizeRemoteRepoRef,
  parseRemoteRepoId,
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

interface InitialRepoRefresh {
  id: string
  token: number
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
    const probe = await probeRepository(entry.id)
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

export function addResolvedRepo(
  s: Pick<ReposStore, 'repos' | 'restorableRepoCache' | 'order'>,
  resolvedRepo: ResolvedRepo,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean } {
  const { id, name } = resolvedRepo
  const existing = s.repos[id]
  if (existing) {
    if (
      !resolvedRepo.target ||
      (existing.remote.target &&
        existing.remote.target.alias === resolvedRepo.target.alias &&
        existing.remote.target.host === resolvedRepo.target.host &&
        existing.remote.target.user === resolvedRepo.target.user &&
        existing.remote.target.port === resolvedRepo.target.port &&
        existing.remote.target.remotePath === resolvedRepo.target.remotePath)
    ) {
      return { repos: s.repos, order: s.order, changed: false }
    }
    return {
      repos: {
        ...s.repos,
        [id]: {
          ...existing,
          remote: {
            ...existing.remote,
            target: resolvedRepo.target,
            connectivity: 'connected',
          },
        },
      },
      order: s.order,
      changed: false,
    }
  }
  const repo = restoreRepoProjectionFromSnapshot(emptyRepo(id, name), s.restorableRepoCache[id])
  if (resolvedRepo.target) {
    repo.remote.target = resolvedRepo.target
    repo.remote.connectivity = 'connected'
  }
  return {
    repos: { ...s.repos, [id]: repo },
    order: orderedInsert(s.order, id, rankById),
    changed: true,
  }
}

/**
 * Mark a repo as unavailable. Two paths:
 *   - If the repo isn't in the store yet, insert it (e.g. ensureWorkspaceOpen
 *     got a probe failure back). Uses the restorable cache for any cached
 *     name/branches, then flips availability.
 *   - If a placeholder (from addConnectingRepo) is already there, promote
 *     it in place — preserves the cached projection, updates target if
 *     the probe produced one, and flips connectivity to 'unreachable'.
 */
export function addUnavailableRepo(
  s: Pick<ReposStore, 'repos' | 'restorableRepoCache' | 'order'>,
  id: string,
  reason: string,
  target?: RemoteRepoTarget,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean } {
  const existing = s.repos[id]
  if (existing) {
    return {
      repos: {
        ...s.repos,
        [id]: {
          ...existing,
          availability: { phase: 'unavailable', reason, checkedAt: Date.now() },
          remote: target
            ? { ...existing.remote, target, connectivity: 'unreachable' }
            : { ...existing.remote, connectivity: 'unreachable' },
        },
      },
      order: s.order,
      changed: true,
    }
  }
  const cached = s.restorableRepoCache[id]
  const repo = restoreRepoProjectionFromSnapshot(
    emptyRepo(id, cached?.name || target?.displayName || lastPathSegment(id)),
    cached,
  )
  if (target) repo.remote.target = target
  repo.remote.connectivity = 'unreachable'
  repo.availability = { phase: 'unavailable', reason, checkedAt: Date.now() }
  return {
    repos: { ...s.repos, [id]: repo },
    order: s.order.includes(id) ? s.order : orderedInsert(s.order, id, rankById),
    changed: true,
  }
}

/**
 * Insert a placeholder tab for a session entry whose probe is still in
 * flight. The placeholder paints the cached branch projection (if any)
 * immediately and marks the remote as 'connecting' so the tab strip can
 * show a spinner without waiting for the SSH handshake. The probe
 * resolution then promotes it to 'connected' or 'unreachable' via
 * addResolvedRepo / addUnavailableRepo. No-op if the repo is already
 * in the store (so calling this twice for the same entry is safe).
 *
 * Note: we intentionally do NOT set `remote.target` here. The ref only
 * carries alias/remotePath; host/user/port require `resolveRemoteRepositoryTarget`,
 * which hasn't run yet. Until the probe succeeds and addResolvedRepo
 * fills in the target, the placeholder lives in a "known alias,
 * unknown concrete host" state — `connectivity: 'connecting'` is the
 * signal callers should branch on rather than reading target fields.
 */
export function addConnectingRepo(
  s: Pick<ReposStore, 'repos' | 'restorableRepoCache' | 'order'>,
  entry: RepoSessionEntry,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean; id: string } {
  const id = entry.id
  if (s.repos[id]) return { repos: s.repos, order: s.order, changed: false, id }
  const cached = s.restorableRepoCache[id]
  const fallbackName = entry.kind === 'remote' ? entry.ref.displayName : lastPathSegment(id)
  const repo = restoreRepoProjectionFromSnapshot(emptyRepo(id, cached?.name || fallbackName), cached)
  if (entry.kind === 'remote') {
    repo.remote.connectivity = 'connecting'
  }
  // 'refreshing' so the cached branches render with a stale indicator
  // (resourceInitialLoading would hide them).
  if (cached && cached.data.branches.length > 0) {
    repo.resources.snapshot = { ...repo.resources.snapshot, phase: 'refreshing', error: null, stale: true }
  }
  return {
    repos: { ...s.repos, [id]: repo },
    order: orderedInsert(s.order, id, rankById),
    changed: true,
    id,
  }
}

export function refreshInitialRepoState(get: ReposGet, refresh: InitialRepoRefresh) {
  const repo = get().repos[refresh.id]
  if (!repo || repo.instanceToken !== refresh.token) return
  void runRepoRefreshIntent(get, {
    kind: 'core-data-changed',
    reason: 'initial-load',
    id: refresh.id,
    token: refresh.token,
  })
}

function applyWorkspaceOpen(
  s: Pick<ReposStore, 'repos' | 'order' | 'restorableRepoCache'>,
  repo: ResolvedRepo,
): {
  repos: ReposStore['repos']
  order: string[]
  changed: boolean
  id: string
} {
  const { repos, order, changed } = addResolvedRepo(s, repo)
  return { repos, order, changed, id: repo.id }
}

export function createRuntimeRepoLifecycleActions(
  set: ReposSet,
  get: ReposGet,
): Pick<ReposStore, 'ensureWorkspaceOpen' | 'closeRepo'> {
  return {
    async ensureWorkspaceOpen(pathOrEntry: string | RepoSessionEntry): Promise<OpenRepoResult> {
      const entry = sessionEntryFromInput(pathOrEntry)
      const resolved = await resolveRepoPath(entry, undefined, 'error.not-git-repo')
      if (!resolved.repo) return { ok: false, message: resolved.reason ?? 'error.not-git-repo' }
      const repo = resolved.repo
      const { id } = repo
      let initialRefresh: InitialRepoRefresh | null = null
      const recentEntry = repo.target ? remoteRepoSessionEntry(repo.target) : { kind: 'local' as const, id }
      void recordRecentRepo(recentEntry).catch(() => {
        /* recent menu is best-effort */
      })

      set((s) => {
        const existingRepo = s.repos[id]
        const { repos, order, changed } = applyWorkspaceOpen(s, repo)
        const repoToRefresh = changed ? repos[id] : existingRepo
        if (repoToRefresh) initialRefresh = { id, token: repoToRefresh.instanceToken }
        return changed ? { repos, order } : s
      })

      if (initialRefresh) refreshInitialRepoState(get, initialRefresh)
      return { ok: true, id }
    },

    closeRepo(id: string) {
      disposeRepoRuntime(id)
      // Tell main to abort any cancellable network op for this repo —
      // otherwise a `git push` started right before the user closed the
      // tab keeps running for up to the network timeout, charged to a
      // tab that no longer exists. Fire-and-forget; failure is fine.
      void abortRepositoryOperation(id).catch(() => {
        /* main may have nothing to abort — ignore */
      })
      set((s) => {
        if (!s.repos[id]) return s
        const repos = { ...s.repos }
        const branchSearchQueries = { ...s.branchSearchQueries }
        const selectedTerminalByWorktree = { ...s.selectedTerminalByWorktree }
        delete repos[id]
        delete branchSearchQueries[id]
        for (const worktreeKey of Object.keys(selectedTerminalByWorktree)) {
          if (worktreeKey.startsWith(`${id}\0`)) delete selectedTerminalByWorktree[worktreeKey]
        }
        const order = s.order.filter((x) => x !== id)
        const activeId = nextActiveRepoIdAfterWorkspaceClose(s.order, s.activeId, id)
        return { repos, branchSearchQueries, selectedTerminalByWorktree, order, activeId }
      })
    },
  }
}
