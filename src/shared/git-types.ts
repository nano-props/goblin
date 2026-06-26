// Git domain types shared by main (which produces them) and client
// (which consumes them via IPC). Putting these in `src/shared/` keeps
// main/client bundles independent — neither side has to import the
// other's module graph just to know what a `BranchSnapshotInfo` looks like.

import type { WorktreeBootstrapSummary } from '#/shared/worktree-bootstrap-summary.ts'

export interface BranchSnapshotInfo {
  name: string
  isCurrent: boolean
  isDefault?: boolean
  tracking?: string
  trackingGone?: boolean
  ahead: number
  behind: number
  lastCommitHash: string
  lastCommitMessage: string
  lastCommitDate: string
  lastCommitAuthor: string
  worktree?: BranchWorktreeSnapshot
  mergedToDefault?: boolean
  pullRequest?: PullRequestInfo
}

export interface BranchWorktreeSnapshot {
  path: string
  isPrimary?: boolean
  isLocked?: boolean
  summary?: BranchWorktreeSnapshotSummary
}

export interface BranchWorktreeSnapshotSummary {
  dirty?: boolean
  changeCount?: number
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

export function branchPullRequestBelongsToBranch(
  branch: Pick<BranchSnapshotInfo, 'name' | 'isDefault'>,
  pullRequest: PullRequestInfo,
): boolean {
  if (branch.isDefault === true) {
    return pullRequest.headRefName === branch.name && pullRequest.baseRefName === branch.name
  }
  // Refresh results are already keyed by the branch they were requested for.
  // If a PR omits headRefName, keep it attached for regular branches, but
  // never allow an explicit head mismatch.
  if (pullRequest.headRefName && pullRequest.headRefName !== branch.name) return false
  return true
}

export type PullRequestFetchMode = 'summary' | 'full'

export interface WorktreeInfo {
  path: string
  branch?: string
  isBare: boolean
  isPrimary: boolean
  isDirty?: boolean
  changeCount?: number
  isLocked?: boolean
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

export const DEFAULT_REPOSITORY_LOG_COUNT = 50

export interface GitRemoteInfo {
  name: string
  fetchUrl: string
  pushUrl: string
}

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

export interface ExecResult {
  ok: boolean
  message: string
  /**
   * True when an operation returned a failure after it had already changed
   * repository state. Clients should refresh even if they usually skip
   * refresh-on-error for the action.
   */
  repoChanged?: boolean
  worktreeBootstrap?: WorktreeBootstrapSummary
}

/** Branch names we treat as protected — direct push/delete/etc. require
 *  extra confirmation, and "delete branch" is forbidden outright. Shared
 *  between main (server-side enforcement in IPC handlers) and client
 *  (UX gating in menus and dialogs) so both sides agree on the list. */
export const PROTECTED_BRANCHES: ReadonlySet<string> = new Set(['main', 'master', 'develop', 'trunk'])
