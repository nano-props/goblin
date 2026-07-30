import type {
  RemoteWorkspaceConnectionResult,
  RemoteWorkspaceRuntimeLifecycle,
  RemoteWorkspaceTarget,
} from '#/shared/remote-workspace.ts'
import type { WorkspaceProbeState, WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'

export type SettledRemoteWorkspaceLifecycle = Extract<RemoteWorkspaceRuntimeLifecycle, { kind: 'ready' | 'failed' }>

export type RemoteWorkspaceLifecycleRunResult =
  { kind: 'settled'; lifecycle: SettledRemoteWorkspaceLifecycle } | { kind: 'superseded' } | { kind: 'stale-runtime' }

export interface RemoteWorkspaceTerminalCommitPlan {
  workspaceProbe?: {
    mode: 'initial-only' | 'refresh'
    probe: WorkspaceSettledProbeState
    beforeCommit?: (input: { before: WorkspaceProbeState; after: WorkspaceSettledProbeState }) => Promise<void>
  }
}

export function planRemoteWorkspaceProbeTransition(
  current: WorkspaceProbeState,
  plan: RemoteWorkspaceTerminalCommitPlan,
): { before: WorkspaceProbeState; after: WorkspaceSettledProbeState } | null {
  const workspaceProbe = plan.workspaceProbe
  if (!workspaceProbe) return null
  if (workspaceProbe.mode === 'initial-only' && current.status !== 'probing') return null
  return { before: current, after: workspaceProbe.probe }
}

export function projectSettledRemoteWorkspaceLifecycle(
  result: RemoteWorkspaceConnectionResult,
  attemptId: number,
): SettledRemoteWorkspaceLifecycle {
  return result.kind === 'ready'
    ? { kind: 'ready', attemptId, target: result.lifecycle.target }
    : {
        kind: 'failed',
        attemptId,
        reason: result.lifecycle.reason,
        ...(result.lifecycle.target ? { target: result.lifecycle.target } : {}),
      }
}

export function remoteWorkspaceLifecycleTarget(
  lifecycle: RemoteWorkspaceRuntimeLifecycle,
): RemoteWorkspaceTarget | null {
  return lifecycle.kind === 'ready' || lifecycle.kind === 'failed' ? (lifecycle.target ?? null) : null
}

export function settledRemoteWorkspaceLifecycleResult(
  lifecycle: RemoteWorkspaceRuntimeLifecycle,
): Extract<RemoteWorkspaceLifecycleRunResult, { kind: 'settled' }> {
  if (lifecycle.kind !== 'ready' && lifecycle.kind !== 'failed') {
    throw new Error('remote workspace lifecycle must be terminal before it settles')
  }
  return { kind: 'settled', lifecycle }
}

export function supersededRemoteWorkspaceLifecycleResult(
  currentWorkspaceRuntimeId: string | null,
  expectedWorkspaceRuntimeId: string,
): RemoteWorkspaceLifecycleRunResult {
  return currentWorkspaceRuntimeId === expectedWorkspaceRuntimeId ? { kind: 'superseded' } : { kind: 'stale-runtime' }
}
