import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { toRemoteWorkspaceFailureReason, type RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
type WorkspaceAvailabilityTarget = Pick<WorkspaceState, 'availability' | 'admission' | 'capability'>

const UNAVAILABLE_REASONS = new Set([
  'error.path-not-found',
  'error.path-not-directory',
  'error.path-permission-denied',
  'error.ssh-config-changed',
])

export function isWorkspaceUnavailableReason(message: string): boolean {
  return UNAVAILABLE_REASONS.has(message)
}

export function markWorkspaceAvailable(workspace: Pick<WorkspaceState, 'availability'>): void {
  workspace.availability = { phase: 'available' }
}

export function markWorkspaceUnavailable(workspace: WorkspaceAvailabilityTarget, reason: string): void {
  workspace.availability = { phase: 'unavailable', reason, checkedAt: Date.now() }
  clearGitFetchFailure(workspace)
}

/**
 * Set the remote lifecycle to `connecting` (entry point of a fresh
 * remote-workspace run). The lifecycle union owns the target and the
 * `connecting` variant has no slot for it. Pass-through to availability keeps the
 * refresh-pipeline call sites (refresh.ts) that flip
 * `availability` from `available` working unchanged — the
 * availability mirror is still useful as a hint, not as the
 * lifecycle signal.
 */
export function markRemoteLifecycleConnecting(workspace: WorkspaceAvailabilityTarget): void {
  const admission = remoteWorkspaceAdmission(workspace)
  admission.lifecycle = { kind: 'connecting' }
  clearGitFetchFailure(workspace)
}

/**
 * Set the remote lifecycle to `ready` with a concrete target. This is
 * the success terminus of a remote-workspace run. Mirrors
 * `markWorkspaceAvailable` on the availability field (kept as a hint
 * for the refresh-pipeline guards in refresh.ts).
 */
export function markRemoteLifecycleReady(workspace: WorkspaceAvailabilityTarget, target: RemoteWorkspaceTarget): void {
  const admission = remoteWorkspaceAdmission(workspace)
  admission.lifecycle = { kind: 'ready', target }
  markWorkspaceAvailable(workspace)
}

/**
 * Set the remote lifecycle to `failed` with a reason and an optional
 * last-known target. Mirrors `markWorkspaceUnavailable` on the
 * availability field (kept as a hint for the refresh-pipeline
 * guards in refresh.ts).
 */
export function markRemoteLifecycleFailed(
  workspace: WorkspaceAvailabilityTarget,
  reason: string,
  target?: RemoteWorkspaceTarget,
): void {
  const lifecycleReason = toRemoteWorkspaceFailureReason(reason)
  const admission = remoteWorkspaceAdmission(workspace)
  admission.lifecycle = target
    ? { kind: 'failed', reason: lifecycleReason, target }
    : { kind: 'failed', reason: lifecycleReason }
  markWorkspaceUnavailable(workspace, reason)
}

function clearGitFetchFailure(workspace: Pick<WorkspaceState, 'capability'>): void {
  if (workspace.capability.kind !== 'git') return
  workspace.capability.git.remote.fetchFailed = false
  workspace.capability.git.remote.fetchError = null
}

function remoteWorkspaceAdmission(
  workspace: Pick<WorkspaceState, 'admission'>,
): Extract<WorkspaceState['admission'], { kind: 'remote' }> {
  if (workspace.admission.kind !== 'remote')
    throw new Error('Remote lifecycle requires remote workspace admission')
  return workspace.admission
}
