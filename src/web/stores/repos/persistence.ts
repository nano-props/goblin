import { LRUCache } from 'lru-cache'
import * as v from 'valibot'
import type { ReposSet } from '#/web/stores/repos/types.ts'
import { selectedBranchForBranchSet } from '#/web/stores/repos/branch-view-mode.ts'
import { finishResourceSuccess } from '#/web/stores/repos/resources.ts'
import type { CachedRepoState, RepoState } from '#/web/stores/repos/types.ts'
import { stripBranchWorktreeMetadata, worktreeStatesFromBranches } from '#/web/stores/repos/worktree-state.ts'
const MAX_CACHE_AGE_MS = 14 * 24 * 60 * 60 * 1000
const MAX_REPOS = 50
const FiniteNumber = v.pipe(v.number(), v.finite())

const PullRequestSchema = v.object({
  number: FiniteNumber,
  title: v.string(),
  url: v.string(),
  state: v.picklist(['open', 'merged', 'closed']),
  isDraft: v.optional(v.boolean()),
  createdAt: v.optional(v.string()),
  author: v.optional(v.string()),
  baseRefName: v.optional(v.string()),
  headRefName: v.optional(v.string()),
  headRepositoryOwner: v.optional(v.string()),
  isCrossRepository: v.optional(v.boolean()),
  checks: v.optional(
    v.object({
      total: FiniteNumber,
      passing: FiniteNumber,
      failing: FiniteNumber,
      pending: FiniteNumber,
    }),
  ),
  reviewDecision: v.optional(v.nullable(v.picklist(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']))),
  mergeable: v.optional(v.picklist(['MERGEABLE', 'CONFLICTING', 'UNKNOWN'])),
})

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
  pullRequest: v.optional(PullRequestSchema),
})

const StatusEntrySchema = v.object({
  x: v.string(),
  y: v.string(),
  path: v.string(),
})

const WorktreeStatusSchema = v.object({
  path: v.string(),
  branch: v.optional(v.string()),
  head: v.optional(v.string()),
  isMain: v.boolean(),
  entries: v.array(StatusEntrySchema),
})

const WorktreeStateSchema = v.object({
  path: v.string(),
  branch: v.optional(v.string()),
  head: v.optional(v.string()),
  isDetached: v.optional(v.boolean()),
  isMain: v.boolean(),
  isDirty: v.optional(v.boolean()),
  changeCount: v.optional(FiniteNumber),
  isLocked: v.optional(v.boolean()),
})

const CachedRepoSchema = v.object({
  savedAt: FiniteNumber,
  name: v.string(),
  data: v.object({
    branches: v.array(BranchSchema),
    currentBranch: v.string(),
    status: v.array(WorktreeStatusSchema),
    statusLoaded: v.boolean(),
    worktreesByPath: v.optional(v.record(v.string(), WorktreeStateSchema)),
  }),
  ui: v.object({
    selectedBranch: v.nullable(v.string()),
    branchViewMode: v.picklist(['all', 'worktrees', 'no-worktree']),
    detailTab: v.picklist(['status', 'terminal']),
    worktreePathOrder: v.optional(v.array(v.string()), []),
  }),
})

export function hydrateCachedRepo(repo: RepoState, cached: CachedRepoState | undefined): RepoState {
  if (!cached || isExpired(cached.savedAt)) return repo
  const selectedBranch = selectedBranchForBranchSet({
    branches: cached.data.branches,
    currentBranch: cached.data.currentBranch,
    selectedBranch: cached.ui.selectedBranch,
    viewMode: cached.ui.branchViewMode,
  })
  const resources = {
    ...repo.resources,
    snapshot: { ...repo.resources.snapshot },
    status: { ...repo.resources.status },
  }
  if (cached.data.branches.length > 0) finishResourceSuccess(resources.snapshot, cached.savedAt)
  if (cached.data.statusLoaded) finishResourceSuccess(resources.status, cached.savedAt)
  const branches = stripBranchWorktreeMetadata(cached.data.branches)
  return {
    ...repo,
    name: cached.name || repo.name,
    data: {
      ...repo.data,
      branches,
      currentBranch: cached.data.currentBranch,
      status: cached.data.status,
      statusLoaded: cached.data.statusLoaded,
      worktreesByPath: cached.data.worktreesByPath,
    },
    resources,
    ui: {
      ...repo.ui,
      selectedBranch,
      branchViewMode: cached.ui.branchViewMode,
      detailTab: cached.ui.detailTab === 'terminal' ? 'terminal' : 'status',
      worktreePathOrder: cached.ui.worktreePathOrder,
    },
    cache: {
      source: 'cache',
      savedAt: cached.savedAt,
    },
  }
}

export function persistRepoCache(set: ReposSet, repo: RepoState | undefined, token: number): void {
  if (!repo) return
  if (repo.instanceToken !== token) return
  const entry = repoCacheEntry(repo)
  if (!entry) return
  set((s) => {
    if (s.repos[repo.id]?.instanceToken !== token) return s
    const repoCache = trimRepoCache({ ...s.repoCache, [repo.id]: entry })
    return { repoCache }
  })
}

export function normalizeRepoCache(value: unknown): Record<string, CachedRepoState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([id, raw]) => [id, normalizeRepoCacheEntry(raw)] as const)
    .filter((entry): entry is readonly [string, CachedRepoState] => entry[1] !== null && !isExpired(entry[1].savedAt))
  return trimRepoCache(Object.fromEntries(entries))
}

function repoCacheEntry(repo: RepoState): CachedRepoState | null {
  if (repo.data.branches.length === 0 && !repo.data.statusLoaded) return null
  return {
    savedAt: Date.now(),
    name: repo.name,
    data: {
      branches: stripBranchWorktreeMetadata(repo.data.branches),
      currentBranch: repo.data.currentBranch,
      status: repo.data.status,
      statusLoaded: repo.data.statusLoaded,
      worktreesByPath: worktreeStatesFromBranches(repo.data.branches, repo.data.worktreesByPath, repo.data.status),
    },
    ui: {
      selectedBranch: repo.ui.selectedBranch,
      branchViewMode: repo.ui.branchViewMode,
      detailTab: repo.ui.detailTab === 'terminal' ? 'terminal' : 'status',
      worktreePathOrder: repo.ui.worktreePathOrder,
    },
  }
}

function trimRepoCache(cache: Record<string, CachedRepoState>): Record<string, CachedRepoState> {
  const lru = new LRUCache<string, CachedRepoState>({ max: MAX_REPOS })
  for (const [id, entry] of Object.entries(cache).sort(([, a], [, b]) => a.savedAt - b.savedAt)) {
    if (!isExpired(entry.savedAt)) lru.set(id, entry)
  }
  return Object.fromEntries(lru.entries())
}

function isExpired(savedAt: number): boolean {
  return Date.now() - savedAt > MAX_CACHE_AGE_MS
}

function normalizeRepoCacheEntry(value: unknown): CachedRepoState | null {
  const parsed = v.safeParse(CachedRepoSchema, value)
  if (!parsed.success) return null
  const cached = parsed.output
  const worktreesByPath = worktreeStatesFromBranches(
    cached.data.branches,
    cached.data.worktreesByPath ?? {},
    cached.data.status,
  )
  return {
    ...cached,
    data: {
      ...cached.data,
      branches: stripBranchWorktreeMetadata(cached.data.branches),
      worktreesByPath,
    },
    ui: {
      ...cached.ui,
      detailTab: cached.ui.detailTab === 'terminal' ? 'terminal' : 'status',
      worktreePathOrder: cached.ui.worktreePathOrder,
    },
  }
}
