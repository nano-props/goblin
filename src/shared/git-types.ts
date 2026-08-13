// Git domain types shared by main (which produces them) and client
// (which consumes them via IPC). Putting these in `src/shared/` keeps
// main/client bundles independent — neither side has to import the
// other's module graph just to know what a `BranchSnapshotInfo` looks like.

import type { WorktreeBootstrapSummary } from '#/shared/worktree-bootstrap-summary.ts'
import type { GitHead } from '#/shared/git-head.ts'

export type GitOperation =
  | { kind: 'rebase'; branchName: string | null }
  | { kind: 'merge' }
  | { kind: 'cherry-pick' }
  | { kind: 'revert' }
  | { kind: 'bisect' }

/** Complete repository worktree membership, independent of branch rows. */
export interface RepoWorktreeSnapshot {
  path: string
  head: GitHead
  headOid: string
  operation: GitOperation | null
  isPrimary: boolean
  isLocked: boolean
}

export interface BranchSnapshotInfo {
  name: string
  isCurrent: boolean
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
  /** Read-only branch-row projection derived atomically from authoritative worktree membership. */
  worktree?: BranchWorktreeProjection
  mergedToDefault?: boolean
}

export interface BranchWorktreeProjection {
  path: string
  isPrimary: boolean
  isLocked: boolean
}

export function repoWorktreeForBranch(
  worktrees: readonly RepoWorktreeSnapshot[],
  branchName: string,
): RepoWorktreeSnapshot | undefined {
  return worktrees.find((worktree) => worktree.head.kind === 'branch' && worktree.head.branchName === branchName)
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
  /** Full object id reported by `git worktree list`; absent only in narrow test/admission fixtures. */
  headOid?: string
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

export const GIT_HASH_RE = /^[0-9a-fA-F]{7,64}$/

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

/** Branch names we treat as protected — direct push/delete/etc. require
 *  extra confirmation, and "delete branch" is forbidden outright. Shared
 *  between main (server-side enforcement in IPC handlers) and client
 *  (UX gating in menus and dialogs) so both sides agree on the list. */
export const PROTECTED_BRANCHES: ReadonlySet<string> = new Set(['main', 'master', 'develop', 'trunk'])
