import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { toRemoteRepoFailureReason, type RemoteRepoTarget } from '#/shared/remote-repo.ts'
type RepoAvailabilityTarget = Pick<WorkspaceState, 'availability' | 'admission' | 'capability'>

const UNAVAILABLE_REASONS = new Set([
  'error.path-not-found',
  'error.path-not-directory',
  'error.path-permission-denied',
  'error.ssh-config-changed',
])

export function isRepoUnavailableReason(message: string): boolean {
  return UNAVAILABLE_REASONS.has(message)
}

export function markRepoAvailable(repo: Pick<WorkspaceState, 'availability'>): void {
  repo.availability = { phase: 'available' }
}

export function markRepoUnavailable(repo: RepoAvailabilityTarget, reason: string): void {
  repo.availability = { phase: 'unavailable', reason, checkedAt: Date.now() }
  clearGitFetchFailure(repo)
}

/**
 * Set the remote lifecycle to `connecting` (entry point of a fresh
 * remote-repo run). The lifecycle union owns the target and the
 * `connecting` variant has no slot for it. Pass-through to availability keeps the
 * refresh-pipeline call sites (refresh.ts) that flip
 * `availability` from `available` working unchanged — the
 * availability mirror is still useful as a hint, not as the
 * lifecycle signal.
 */
export function markRemoteLifecycleConnecting(repo: RepoAvailabilityTarget): void {
  const admission = remoteRepoAdmission(repo)
  admission.lifecycle = { kind: 'connecting' }
  clearGitFetchFailure(repo)
}

/**
 * Set the remote lifecycle to `ready` with a concrete target. This is
 * the success terminus of a remote-repo run. Mirrors
 * `markRepoAvailable` on the availability field (kept as a hint
 * for the refresh-pipeline guards in refresh.ts).
 */
export function markRemoteLifecycleReady(
  repo: RepoAvailabilityTarget,
  target: RemoteRepoTarget,
): void {
  const admission = remoteRepoAdmission(repo)
  admission.lifecycle = { kind: 'ready', target }
  markRepoAvailable(repo)
}

/**
 * Set the remote lifecycle to `failed` with a reason and an optional
 * last-known target. Mirrors `markRepoUnavailable` on the
 * availability field (kept as a hint for the refresh-pipeline
 * guards in refresh.ts).
 */
export function markRemoteLifecycleFailed(
  repo: RepoAvailabilityTarget,
  reason: string,
  target?: RemoteRepoTarget,
): void {
  const lifecycleReason = toRemoteRepoFailureReason(reason)
  const admission = remoteRepoAdmission(repo)
  admission.lifecycle = target
    ? { kind: 'failed', reason: lifecycleReason, target }
    : { kind: 'failed', reason: lifecycleReason }
  markRepoUnavailable(repo, reason)
}

function clearGitFetchFailure(repo: Pick<WorkspaceState, 'capability'>): void {
  if (repo.capability.kind !== 'git') return
  repo.capability.git.remote.fetchFailed = false
  repo.capability.git.remote.fetchError = null
}

function remoteRepoAdmission(repo: Pick<WorkspaceState, 'admission'>): Extract<WorkspaceState['admission'], { kind: 'remote' }> {
  if (repo.admission.kind !== 'remote') throw new Error('Remote repository lifecycle requires remote workspace admission')
  return repo.admission
}
