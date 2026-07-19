import { produce, type Draft } from 'immer'
import {
  isRemoteWorkspaceId,
  remoteWorkspaceConnectionTarget,
  type RemoteWorkspaceConnectionLifecycle,
  type RemoteWorkspaceTarget,
} from '#/shared/remote-workspace.ts'
import { workspaceConnectivityLog } from '#/web/logger.ts'
import type {
  GitWorkspaceProjection,
  WorkspaceCapabilityState,
  WorkspaceState,
  WorkspacesSet,
  WorkspacesStore,
} from '#/web/stores/workspaces/types.ts'
import { workspaceGitAvailable, workspaceGitUnavailable, type WorkspaceProbeState } from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { emptyGitWorkspaceProjection } from '#/web/stores/workspaces/workspace-state-factory.ts'

/** The sole transition boundary for authoritative workspace capability state. */
export function acceptWorkspaceProbeState(workspace: WorkspaceState, workspaceProbe: WorkspaceProbeState): void {
  workspace.capability = workspaceCapabilityAfterProbe(workspace, workspaceProbe)
}

function workspaceCapabilityAfterProbe(
  workspace: WorkspaceState,
  workspaceProbe: WorkspaceProbeState,
): WorkspaceCapabilityState {
  if (workspaceProbe.status === 'probing') {
    return { kind: 'probing', probe: workspaceProbe }
  }
  if (workspaceProbe.status === 'unavailable') {
    return { kind: 'unavailable', probe: workspaceProbe }
  }
  if (workspaceGitUnavailable(workspaceProbe)) {
    return { kind: 'filesystem', probe: workspaceProbe }
  }
  if (workspaceGitAvailable(workspaceProbe)) {
    return {
      kind: 'git',
      probe: workspaceProbe,
      git: gitProjectionAcrossProbeTransition(workspace),
    }
  }
  throw new Error('Workspace ready probe has an unsupported Git capability')
}

function gitProjectionAcrossProbeTransition(workspace: WorkspaceState): GitWorkspaceProjection {
  switch (workspace.capability.kind) {
    case 'git':
      return workspace.capability.git
    case 'probing':
    case 'unavailable':
    case 'filesystem':
      return emptyGitWorkspaceProjection()
  }
}

/**
 * Live SSH liveness state for remote workspaces. Derived — never stored —
 * from `isRemoteWorkspaceId(id)` + `admission.lifecycle.kind`. The lifecycle
 * union is the single source of truth; availability and target presence
 * are not used to infer connectivity.
 *   - `connecting`:  remote workspace whose lifecycle run has not
 *     converged (placeholder / in-flight probe)
 *   - `connected`:   remote workspace with a converged `ready` lifecycle;
 *     also the default for local workspaces
 *   - `unreachable`: remote workspace whose last probe converged to
 *     `failed`
 */
export type WorkspaceConnectivity = 'connecting' | 'connected' | 'unreachable'

export function deriveWorkspaceConnectivity(workspace: WorkspaceState): WorkspaceConnectivity {
  if (!isRemoteWorkspaceId(workspace.id)) return 'connected'
  const lifecycle = requiredRemoteWorkspaceAdmission(workspace).lifecycle
  if (lifecycle) {
    if (lifecycle.kind === 'failed') return 'unreachable'
    if (lifecycle.kind === 'connecting') return 'connecting'
    return 'connected'
  }
  // A remote workspace without a lifecycle is a malformed fixture or restore.
  // Treat it as `connecting` so the UI shows a spinner — never as a
  // silently-broken `connected` tab.
  if (import.meta.env.DEV) {
    workspaceConnectivityLog.warn(`remote workspace ${workspace.id} has no lifecycle; treating as connecting`)
  }
  return 'connecting'
}

/**
 * The concrete remote target for a remote workspace id + lifecycle, or
 * `null` for local workspaces and remote workspaces whose lifecycle hasn't
 * reached a terminal state with a retained target. This helper is the
 * only sanctioned access path for a concrete remote target.
 *
 * Takes the id and the lifecycle separately so it works on
 * any subset that carries the lifecycle.
 */
export function remoteWorkspaceTarget(
  id: WorkspaceId,
  lifecycle: RemoteWorkspaceConnectionLifecycle | null,
): RemoteWorkspaceTarget | null {
  if (!isRemoteWorkspaceId(id)) return null
  return remoteWorkspaceConnectionTarget(lifecycle)
}

/**
 * Whether a workspace is in a terminal "cannot be operated on" state:
 *   - Local workspace: `availability.phase === 'unavailable'`
 *   - Remote workspace: `admission.lifecycle.kind === 'failed'`
 *
 * Replaces the per-call-site `workspace.availability.phase === 'unavailable'`
 * check. Callers that previously had to know whether they were
 * looking at a local or remote workspace now just call this helper.
 */
export function isWorkspaceUnavailable(workspace: WorkspaceState): boolean {
  if (isRemoteWorkspaceId(workspace.id)) {
    return requiredRemoteWorkspaceAdmission(workspace).lifecycle?.kind === 'failed'
  }
  return workspace.availability.phase === 'unavailable'
}

function requiredRemoteWorkspaceAdmission(
  workspace: WorkspaceState,
): Extract<WorkspaceState['admission'], { kind: 'remote' }> {
  if (workspace.admission.kind !== 'remote') {
    throw new Error('Remote workspace identity requires remote transport admission')
  }
  return workspace.admission
}

type WorkspaceMutator = (workspace: Draft<WorkspaceState>) => void

export function currentWorkspaceRuntimeId(
  state: Pick<WorkspacesStore, 'workspaces'>,
  workspaceId: string,
): string | null {
  return state.workspaces[workspaceId]?.workspaceRuntimeId ?? null
}

/** Apply `mutator` to the workspace at `id` only if its workspaceRuntimeId still
 *  matches the captured one. The check runs inside the functional
 *  setter so it reads the freshest store state, not the caller's
 *  pre-await snapshot. */
export function updateIfFresh(
  set: WorkspacesSet,
  id: string,
  workspaceRuntimeId: string,
  mutator: WorkspaceMutator,
): void {
  set((s) => {
    const workspace = s.workspaces[id]
    if (!workspace || workspace.workspaceRuntimeId !== workspaceRuntimeId) return s
    const nextWorkspace = produce(workspace, mutator)
    return nextWorkspace === workspace ? s : { ...s, workspaces: { ...s.workspaces, [id]: nextWorkspace } }
  })
}
