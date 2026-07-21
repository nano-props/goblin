import { LRUCache } from 'lru-cache'
import * as v from 'valibot'
import type { WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import type { RepoSnapshotCacheEntry, WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { finishDataLoadSuccess } from '#/web/stores/workspaces/repo-data-load-state.ts'
import { stripBranchWorktreeMetadata } from '#/web/stores/workspaces/worktree-state.ts'
import { seedRepoProjectionQueryData } from '#/web/repo-query-cache.ts'
import { readRepoBranchSnapshotQueryProjection, type RepoBranchSnapshotData } from '#/web/repo-branch-read-model.ts'
import { gitWorkspaceProjection, isGitWorkspace } from '#/web/stores/workspaces/git-workspace-projection.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
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
    branchViewMode: v.picklist(['all', 'worktrees']),
  }),
})

function cachedBranches(
  branches: RepoSnapshotCacheEntry['data']['branches'],
): RepoSnapshotCacheEntry['data']['branches'] {
  return stripBranchWorktreeMetadata(branches)
}

function restoreProjectionFromSnapshot(repo: WorkspaceState, snapshot: RepoSnapshotCacheEntry): WorkspaceState {
  if (!isGitWorkspace(repo)) return repo
  const git = gitWorkspaceProjection(repo)
  const dataLoads = {
    ...git.dataLoads,
    repoReadModel: { ...git.dataLoads.repoReadModel },
  }
  if (snapshot.data.branches.length > 0) finishDataLoadSuccess(dataLoads.repoReadModel, snapshot.savedAt)
  return {
    ...repo,
    name: snapshot.name || repo.name,
    capability: {
      ...repo.capability,
      git: {
        ...git,
        dataLoads,
        ui: { branchViewMode: snapshot.ui.branchViewMode },
        projection: { source: 'cache', savedAt: snapshot.savedAt },
      },
    },
  }
}

export function restoreRepoProjectionFromCacheEntry(
  repo: WorkspaceState,
  snapshot: RepoSnapshotCacheEntry | undefined,
): WorkspaceState {
  if (!snapshot || isExpired(snapshot.savedAt)) return repo
  return restoreProjectionFromSnapshot(repo, snapshot)
}

export function seedRepoProjectionQueryFromCacheEntry(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  snapshot: RepoSnapshotCacheEntry | undefined,
): void {
  if (!snapshot || isExpired(snapshot.savedAt)) return
  const cachedSnapshot = {
    branches: cachedBranches(snapshot.data.branches),
    current: snapshot.data.currentBranch,
  }
  const cachedProjection = {
    snapshot: cachedSnapshot,
    pullRequests: null,
    loadedAt: 0,
  }
  seedRepoProjectionQueryData(repoRoot, workspaceRuntimeId, {
    ...cachedProjection,
    requested: { branch: null, pullRequestMode: 'full' },
  })
  seedRepoProjectionQueryData(repoRoot, workspaceRuntimeId, {
    ...cachedProjection,
    requested: { branch: null, pullRequestMode: 'summary' },
  })
}

export function persistRepoSnapshotCacheEntry(
  set: WorkspacesSet,
  repo: WorkspaceState | undefined,
  workspaceRuntimeId: string,
): void {
  if (!repo || !isGitWorkspace(repo)) return
  if (repo.workspaceRuntimeId !== workspaceRuntimeId) return
  const branchModel = readRepoBranchSnapshotQueryProjection(repo)
  const entry = branchModel ? repoSnapshotCacheEntryFromRepo(repo, branchModel) : null
  if (!entry) return
  set((s) => {
    if (s.workspaces[repo.id]?.workspaceRuntimeId !== workspaceRuntimeId) return s
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

function repoSnapshotCacheEntryFromRepo(
  repo: WorkspaceState & { capability: Extract<WorkspaceState['capability'], { kind: 'git' }> },
  branchModel: RepoBranchSnapshotData,
): RepoSnapshotCacheEntry | null {
  if (branchModel.branches.length === 0) return null
  return {
    savedAt: Date.now(),
    name: repo.name,
    data: {
      branches: cachedBranches(branchModel.branches),
      currentBranch: branchModel.currentBranch,
    },
    ui: {
      branchViewMode: gitWorkspaceProjection(repo).ui.branchViewMode,
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
      branchViewMode: snapshot.ui.branchViewMode,
    },
  }
}
