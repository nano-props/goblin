// Canonical mode-discriminated input for "create a worktree".
//
// Every layer — web (dialog), server (IPC + repo backend), system (git
// worktree add / SSH command script) — speaks the same shape. The trust
// boundary is `normalizeCreateWorktreeInput`: anything coming in from the
// renderer is re-validated here, then re-validated again by the system
// layer that maps it to argv or a shell script. Two layers of validation
// keep a malformed payload from ever reaching `git worktree add`.
//
// We deliberately exclude the `detached` mode here — detached worktrees
// would land in `worktreesByPath` but have no matching `BranchSnapshotInfo`,
// which leaves them invisible in the BranchList. Reintroducing the mode
// should be a paired change with a detached-worktree row in the list.

import { isSafeBranchName } from '#/shared/refnames.ts'

export type CreateWorktreeMode =
  | { kind: 'newBranch'; newBranch: string; baseRef: string }
  | { kind: 'existingBranch'; branch: string }
  | { kind: 'trackRemoteBranch'; remoteRef: string; localBranch: string }

export interface CreateWorktreeInput {
  worktreePath: string
  mode: CreateWorktreeMode
}

/** Wire-shape envelope used by the IPC bridge: includes `cwd` and the
 *  optional invalidation `sourceToken` on top of the canonical input. */
export interface CreateWorktreeRpcInput extends CreateWorktreeInput {
  cwd: string
  sourceToken?: string
}

export function normalizeCreateWorktreeInput(input: unknown): CreateWorktreeInput | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as { worktreePath?: unknown; mode?: unknown }
  const worktreePath = typeof raw.worktreePath === 'string' ? raw.worktreePath.trim() : ''
  if (!worktreePath) return null
  const mode = normalizeCreateWorktreeMode(raw.mode)
  return mode ? { worktreePath, mode } : null
}

function normalizeCreateWorktreeMode(input: unknown): CreateWorktreeMode | null {
  if (!input || typeof input !== 'object') return null
  const mode = input as Record<string, unknown>
  switch (mode.kind) {
    case 'newBranch': {
      const newBranch = stringField(mode.newBranch)
      const baseRef = stringField(mode.baseRef)
      return newBranch && baseRef && isSafeBranchName(newBranch) && isSafeRefInput(baseRef)
        ? { kind: 'newBranch', newBranch, baseRef }
        : null
    }
    case 'existingBranch': {
      const branch = stringField(mode.branch)
      return branch && isSafeBranchName(branch) ? { kind: 'existingBranch', branch } : null
    }
    case 'trackRemoteBranch': {
      const remoteRef = stringField(mode.remoteRef)
      const localBranch = stringField(mode.localBranch)
      return remoteRef && localBranch && isRemoteTrackingRef(remoteRef) && isSafeBranchName(localBranch)
        ? { kind: 'trackRemoteBranch', remoteRef, localBranch }
        : null
    }
    default:
      return null
  }
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRemoteTrackingRef(ref: string): boolean {
  const slash = ref.indexOf('/')
  if (slash <= 0) return false
  if (ref.endsWith('/HEAD')) return false
  const remote = ref.slice(0, slash)
  const branch = ref.slice(slash + 1)
  return isSafeRemoteName(remote) && isSafeBranchName(branch)
}

function isSafeRemoteName(remote: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)
}

function isSafeRefInput(ref: string): boolean {
  return isSafeBranchName(ref) || isRemoteTrackingRef(ref)
}

/** Parse the output of `git for-each-ref refs/remotes/`, dropping
 *  refs that don't fit the `<remote>/<branch>` shape and the symbolic
 *  `<remote>/HEAD` pointer. Shared by the local (system/git/remote-refs.ts)
 *  and remote (system/ssh/git.ts) callers so a malformed ref is treated
 *  the same on both sides. */
export function parseRemoteTrackingRefs(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((ref) => isRemoteTrackingRef(ref))
}

/** Derive a default local-branch name from a remote-tracking ref.
 *  Returns null when the ref isn't shaped like `origin/feature/x`. */
export function deriveLocalBranchFromRemoteRef(remoteRef: string): string | null {
  if (!isRemoteTrackingRef(remoteRef)) return null
  const slash = remoteRef.indexOf('/')
  const branch = slash >= 0 ? remoteRef.slice(slash + 1) : ''
  return isSafeBranchName(branch) ? branch : null
}
