import { LRUCache } from 'lru-cache'
import * as v from 'valibot'
import type { ReposSet } from '#/web/stores/repos/types.ts'
import { selectedBranchForBranchSet } from '#/web/stores/repos/branch-view-mode.ts'
import type { RestorableRepoSnapshot, RepoState } from '#/web/stores/repos/types.ts'
import { finishResourceSuccess } from '#/web/stores/repos/resources.ts'
import { stripBranchWorktreeMetadata } from '#/web/stores/repos/worktree-state.ts'
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

const RestorableRepoSnapshotSchema = v.object({
  savedAt: FiniteNumber,
  name: v.string(),
  data: v.object({
    branches: v.array(BranchSchema),
    currentBranch: v.string(),
  }),
  ui: v.object({
    selectedBranch: v.nullable(v.string()),
    branchViewMode: v.picklist(['all', 'worktrees', 'no-worktree']),
    detailTab: v.picklist(['status', 'changes', 'terminal']),
  }),
})

function normalizeCachedDetailTab(tab: string): 'status' | 'changes' | 'terminal' {
  return tab === 'terminal' || tab === 'changes' ? tab : 'status'
}

function cachedBranches(branches: RepoState['data']['branches']): RestorableRepoSnapshot['data']['branches'] {
  return stripBranchWorktreeMetadata(branches).map(({ pullRequest: _pullRequest, ...branch }) => branch)
}

function restoreProjectionFromSnapshot(repo: RepoState, snapshot: RestorableRepoSnapshot): RepoState {
  const selectedBranch = selectedBranchForBranchSet({
    branches: snapshot.data.branches,
    currentBranch: snapshot.data.currentBranch,
    selectedBranch: snapshot.ui.selectedBranch,
    viewMode: snapshot.ui.branchViewMode,
  })
  const resources = {
    ...repo.resources,
    snapshot: { ...repo.resources.snapshot },
  }
  if (snapshot.data.branches.length > 0) finishResourceSuccess(resources.snapshot, snapshot.savedAt)
  const branches = cachedBranches(snapshot.data.branches)
  return {
    ...repo,
    name: snapshot.name || repo.name,
    data: {
      ...repo.data,
      branches,
      currentBranch: snapshot.data.currentBranch,
    },
    resources,
    ui: {
      ...repo.ui,
      selectedBranch,
      branchViewMode: snapshot.ui.branchViewMode,
      detailTab: normalizeCachedDetailTab(snapshot.ui.detailTab),
    },
    projection: {
      source: 'cache',
      savedAt: snapshot.savedAt,
    },
  }
}

export function restoreRepoProjectionFromSnapshot(
  repo: RepoState,
  snapshot: RestorableRepoSnapshot | undefined,
): RepoState {
  if (!snapshot || isExpired(snapshot.savedAt)) return repo
  return restoreProjectionFromSnapshot(repo, snapshot)
}

export function persistRestorableRepoSnapshot(set: ReposSet, repo: RepoState | undefined, token: number): void {
  if (!repo) return
  if (repo.instanceToken !== token) return
  const entry = restorableRepoSnapshotFromRepo(repo)
  if (!entry) return
  set((s) => {
    if (s.repos[repo.id]?.instanceToken !== token) return s
    const restorableRepoCache = trimRepoCache({ ...s.restorableRepoCache, [repo.id]: entry })
    return { restorableRepoCache }
  })
}

export function normalizeRestorableRepoCache(value: unknown): Record<string, RestorableRepoSnapshot> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([id, raw]) => [id, normalizeRestorableRepoSnapshotEntry(raw)] as const)
    .filter(
      (entry): entry is readonly [string, RestorableRepoSnapshot] => entry[1] !== null && !isExpired(entry[1].savedAt),
    )
  return trimRepoCache(Object.fromEntries(entries))
}

function restorableRepoSnapshotFromRepo(repo: RepoState): RestorableRepoSnapshot | null {
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
      detailTab: normalizeCachedDetailTab(repo.ui.detailTab),
    },
  }
}

function trimRepoCache(cache: Record<string, RestorableRepoSnapshot>): Record<string, RestorableRepoSnapshot> {
  const lru = new LRUCache<string, RestorableRepoSnapshot>({ max: MAX_REPOS })
  for (const [id, entry] of Object.entries(cache).sort(([, a], [, b]) => a.savedAt - b.savedAt)) {
    if (!isExpired(entry.savedAt)) lru.set(id, entry)
  }
  return Object.fromEntries(lru.entries())
}

function isExpired(savedAt: number): boolean {
  return Date.now() - savedAt > MAX_CACHE_AGE_MS
}

function normalizeRestorableRepoSnapshotEntry(value: unknown): RestorableRepoSnapshot | null {
  const parsed = v.safeParse(RestorableRepoSnapshotSchema, value)
  if (!parsed.success) return null
  const snapshot = parsed.output
  return {
    ...snapshot,
    data: {
      ...snapshot.data,
      branches: cachedBranches(snapshot.data.branches),
    },
    ui: {
      ...snapshot.ui,
      detailTab: normalizeCachedDetailTab(snapshot.ui.detailTab),
    },
  }
}
