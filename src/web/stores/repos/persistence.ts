import { LRUCache } from 'lru-cache'
import * as v from 'valibot'
import type { ReposSet } from '#/web/stores/repos/types.ts'
import { selectedBranchForBranchSet } from '#/web/stores/repos/branch-view-mode.ts'
import type { RepoSnapshotCacheEntry, RepoState } from '#/web/stores/repos/types.ts'
import { finishDataLoadSuccess } from '#/web/stores/repos/repo-data-load-state.ts'
import { stripBranchWorktreeMetadata } from '#/web/stores/repos/worktree-state.ts'
import { readRepoBranchReadModel, repoWithBranchReadModel } from '#/web/repo-branch-read-model.ts'
const MAX_CACHE_AGE_MS = 14 * 24 * 60 * 60 * 1000
const MAX_REPOS = 50
const FiniteNumber = v.pipe(v.number(), v.finite())

const BranchSchema = v.object({
  name: v.string(),
  isCurrent: v.boolean(),
  isDefault: v.optional(v.boolean()),
  tracking: v.optional(v.string()),
  trackingGone: v.optional(v.boolean()),
  ahead: FiniteNumber,
  behind: FiniteNumber,
  lastCommitHash: v.string(),
  lastCommitShortHash: v.optional(v.string(), ''),
  lastCommitMessage: v.string(),
  lastCommitDate: v.string(),
  lastCommitAuthor: v.string(),
  worktree: v.optional(
    v.object({
      path: v.string(),
    }),
  ),
  mergedToDefault: v.optional(v.boolean()),
})

const RepoSnapshotCacheEntrySchema = v.object({
  savedAt: FiniteNumber,
  name: v.string(),
  data: v.object({
    branches: v.array(BranchSchema),
    currentBranch: v.string(),
  }),
  ui: v.object({
    selectedBranch: v.nullable(v.string()),
    branchViewMode: v.picklist(['all', 'worktrees']),
  }),
})

function cachedBranches(branches: RepoState['data']['branches']): RepoSnapshotCacheEntry['data']['branches'] {
  return stripBranchWorktreeMetadata(branches).map(({ pullRequest: _pullRequest, ...branch }) => branch)
}

function restoreProjectionFromSnapshot(repo: RepoState, snapshot: RepoSnapshotCacheEntry): RepoState {
  const selectedBranch = selectedBranchForBranchSet({
    branches: snapshot.data.branches,
    currentBranch: snapshot.data.currentBranch,
    selectedBranch: snapshot.ui.selectedBranch,
    viewMode: snapshot.ui.branchViewMode,
  })
  const dataLoads = {
    ...repo.dataLoads,
    snapshot: { ...repo.dataLoads.snapshot },
  }
  if (snapshot.data.branches.length > 0) finishDataLoadSuccess(dataLoads.snapshot, snapshot.savedAt)
  const branches = cachedBranches(snapshot.data.branches)
  return {
    ...repo,
    name: snapshot.name || repo.name,
    data: {
      ...repo.data,
      branches,
      currentBranch: snapshot.data.currentBranch,
    },
    dataLoads,
    ui: {
      ...repo.ui,
      selectedBranch,
      branchViewMode: snapshot.ui.branchViewMode,
    },
    projection: {
      source: 'cache',
      savedAt: snapshot.savedAt,
    },
  }
}

export function restoreRepoProjectionFromCacheEntry(
  repo: RepoState,
  snapshot: RepoSnapshotCacheEntry | undefined,
): RepoState {
  if (!snapshot || isExpired(snapshot.savedAt)) return repo
  return restoreProjectionFromSnapshot(repo, snapshot)
}

export function persistRepoSnapshotCacheEntry(set: ReposSet, repo: RepoState | undefined, repoInstanceId: string): void {
  if (!repo) return
  if (repo.instanceId !== repoInstanceId) return
  const projectedRepo = repoWithBranchReadModel(repo, readRepoBranchReadModel(repo))
  const entry = repoSnapshotCacheEntryFromRepo(projectedRepo)
  if (!entry) return
  set((s) => {
    if (s.repos[repo.id]?.instanceId !== repoInstanceId) return s
    const repoSnapshotCache = trimRepoCache({ ...s.repoSnapshotCache, [repo.id]: entry })
    return { repoSnapshotCache }
  })
}

export function normalizeRepoSnapshotCache(value: unknown): Record<string, RepoSnapshotCacheEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([id, raw]) => [id, normalizeRepoSnapshotCacheEntry(raw)] as const)
    .filter(
      (entry): entry is readonly [string, RepoSnapshotCacheEntry] => entry[1] !== null && !isExpired(entry[1].savedAt),
    )
  return trimRepoCache(Object.fromEntries(entries))
}

function repoSnapshotCacheEntryFromRepo(repo: RepoState): RepoSnapshotCacheEntry | null {
  if (repo.data.branches.length === 0) return null
  return {
    savedAt: Date.now(),
    name: repo.name,
    data: {
      branches: cachedBranches(repo.data.branches),
      currentBranch: repo.data.currentBranch,
    },
    ui: {
      selectedBranch: repo.ui.selectedBranch,
      branchViewMode: repo.ui.branchViewMode,
    },
  }
}

function trimRepoCache(cache: Record<string, RepoSnapshotCacheEntry>): Record<string, RepoSnapshotCacheEntry> {
  const lru = new LRUCache<string, RepoSnapshotCacheEntry>({ max: MAX_REPOS })
  for (const [id, entry] of Object.entries(cache).sort(([, a], [, b]) => a.savedAt - b.savedAt)) {
    if (!isExpired(entry.savedAt)) lru.set(id, entry)
  }
  return Object.fromEntries(lru.entries())
}

function isExpired(savedAt: number): boolean {
  return Date.now() - savedAt > MAX_CACHE_AGE_MS
}

function normalizeRepoSnapshotCacheEntry(value: unknown): RepoSnapshotCacheEntry | null {
  const parsed = v.safeParse(RepoSnapshotCacheEntrySchema, value)
  if (!parsed.success) return null
  const snapshot = parsed.output
  return {
    savedAt: snapshot.savedAt,
    name: snapshot.name,
    data: {
      ...snapshot.data,
      branches: cachedBranches(snapshot.data.branches),
    },
    ui: {
      selectedBranch: snapshot.ui.selectedBranch,
      branchViewMode: snapshot.ui.branchViewMode,
    },
  }
}
