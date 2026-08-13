// Git domain types shared by main (which produces them) and client
// (which consumes them via IPC). Putting these in `src/shared/` keeps
// main/client bundles independent — neither side has to import the
// other's module graph just to know what a `BranchSnapshotInfo` looks like.

import type { WorktreeBootstrapSummary } from '#/shared/worktree-bootstrap-summary.ts'
import type { GitHead } from '#/shared/git-head.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'

export type GitOperation =
  { kind: 'rebase' } | { kind: 'merge' } | { kind: 'cherry-pick' } | { kind: 'revert' } | { kind: 'bisect' }

export function gitOperationRequiresDetachedHead(operation: GitOperation | null): boolean {
  return operation?.kind === 'rebase'
}

/** Branch ownership carried by a worktree, independent of branch-row presentation. */
export interface RepoWorktreeBranchOwnership {
  head: GitHead
  materializedBranch: string | null
}

export interface RepoWorktreeTargetProjection extends RepoWorktreeBranchOwnership {
  path: string
  /** Null only for an unborn attached branch, before its first commit. */
  headOid: string | null
}

export interface RepoWorktreeSnapshot extends RepoWorktreeTargetProjection {
  operation: GitOperation | null
  isPrimary: boolean
  isLocked: boolean
}

export function hasUniqueRepoWorktreeMaterializedBranches(
  worktrees: readonly Pick<RepoWorktreeSnapshot, 'materializedBranch'>[],
): boolean {
  const branches = new Set<string>()
  for (const { materializedBranch } of worktrees) {
    if (materializedBranch === null) continue
    if (branches.has(materializedBranch)) return false
    branches.add(materializedBranch)
  }
  return true
}

export type WorkspacePaneTargetIdentity =
  | { kind: 'git-branch'; branchName: string }
  | {
      kind: 'git-worktree'
      worktreePath: string
      head: GitHead
      materializedBranch: string | null
    }

export interface BranchSnapshotInfo {
  name: string
  isDefault?: boolean
  tracking?: string
  trackingGone?: boolean
  ahead: number
  behind: number
  lastCommitHash: string
  lastCommitShortHash: string
  lastCommitMessage: string
  lastCommitDate: string
  lastCommitAuthor: string
  mergedToDefault?: boolean
}

export function repoWorktreeForBranch<T extends RepoWorktreeBranchOwnership>(
  worktrees: readonly T[],
  branchName: string,
): T | undefined {
  return worktrees.find((worktree) => repoWorktreeMaterializedBranch(worktree) === branchName)
}

export function repoWorktreeMaterializedBranch(worktree: RepoWorktreeBranchOwnership): string | null {
  if (worktree.head.kind === 'branch') {
    if (worktree.materializedBranch !== worktree.head.branchName) {
      throw new Error('Attached worktree materialized branch does not match HEAD')
    }
    return worktree.head.branchName
  }
  return worktree.materializedBranch
}

export interface PullRequestInfo {
  number: number
  title: string
  url: string
  state: 'open' | 'merged' | 'closed'
  isDraft?: boolean
  createdAt?: string
  author?: string
  baseRefName?: string
  headRefName?: string
  headRepositoryOwner?: string
  isCrossRepository?: boolean
  checks?: {
    total: number
    passing: number
    failing: number
    pending: number
  }
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
}

export type PullRequestFetchMode = 'summary' | 'full'

export interface WorktreeInfo {
  path: string
  /** Full object id reported by `git worktree list`, or null for an unborn branch. */
  headOid?: string | null
  branch?: string
  isBare: boolean
  isPrimary: boolean
  isDirty?: boolean
  isLocked?: boolean
  /** Git still has administrative metadata for this worktree, but its
   * physical worktree is no longer usable and may be pruned. */
  isPrunable?: boolean
}

export interface StatusEntry {
  x: string
  y: string
  path: string
}

/** One worktree's working-tree status. The Status tab groups entries by
 *  worktree so users with linked worktrees see all dirty changes, not
 *  just the main worktree's. `isMain` marks the primary worktree (the
 *  repo root), so the UI can surface it differently. */
export interface WorktreeStatus {
  path: string
  branch?: string
  isMain: boolean
  entries: StatusEntry[]
}

export interface LogEntry {
  hash: string
  shortHash: string
  refs: string
  message: string
  author: string
  date: string
}

export const DEFAULT_REPOSITORY_LOG_COUNT = 100

export interface GitRemoteInfo {
  name: string
  fetchUrl: string
  pushUrl: string
}

export type RepoUrlTarget =
  { type: 'root' } | { type: 'branch'; branch: string; remote?: string } | { type: 'commit'; hash: string }

export type BrowserRemoteProvider = 'github' | 'gitlab' | 'external'

export interface RepoRemoteInfo {
  remotes: GitRemoteInfo[]
  hasRemotes: boolean
  hasBrowserRemote: boolean
  browserRemoteProvider?: BrowserRemoteProvider
  remoteProviders: Record<string, BrowserRemoteProvider>
  hasGitHubRemote: boolean
}

export const GIT_OBJECT_ID_OR_PREFIX_RE = /^[0-9a-fA-F]{7,64}$/
export const GIT_OBJECT_ID_RE = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/

export function isFullGitObjectId(value: string): boolean {
  return GIT_OBJECT_ID_RE.test(value) && !/^0+$/u.test(value)
}

export type RepoLogTarget = { kind: 'branch'; branchName: string } | { kind: 'commit'; oid: string }

export function repoLogTargetRevision(target: RepoLogTarget): string | null {
  if (target.kind === 'branch') return isSafeBranchName(target.branchName) ? `refs/heads/${target.branchName}` : null
  return isFullGitObjectId(target.oid) ? target.oid : null
}

// These are application-level recovery notices derived from domain milestones
// or lifecycle uncertainty. They never authorize cleanup, invalidation, retry,
// or client-side state inference.
export const EXEC_RESULT_RECOVERY_MESSAGE_KEYS = [
  'error.worktree-created-followup-failed',
  'error.worktree-removed-followup-failed',
  'error.local-branch-deleted-followup-failed',
  'error.workspace-runtime-settlement-failed',
] as const

export type ExecResultRecoveryMessageKey = (typeof EXEC_RESULT_RECOVERY_MESSAGE_KEYS)[number]

export interface ExecResult {
  ok: boolean
  message: string
}

/** Public result contract for repository mutations with explicit recovery guidance. */
export interface RepoMutationExecResult extends ExecResult {
  /** Static i18n keys selected by the server application flow. */
  recoveryMessageKeys?: readonly ExecResultRecoveryMessageKey[]
  worktreeBootstrap?: WorktreeBootstrapSummary
}

export type CreateWorktreeExecResult =
  (RepoMutationExecResult & { ok: false }) | (RepoMutationExecResult & { ok: true; worktreePath: string })

/** Branch names we treat as protected — direct push/delete/etc. require
 *  extra confirmation, and "delete branch" is forbidden outright. Shared
 *  between main (server-side enforcement in IPC handlers) and client
 *  (UX gating in menus and dialogs) so both sides agree on the list. */
export const PROTECTED_BRANCHES: ReadonlySet<string> = new Set(['main', 'master', 'develop', 'trunk'])
