/** Pure workspace-session state transitions; server writes and runtime ownership stay in the command layer. */

import { recordWithoutKey } from '#/shared/record.ts'
import {
  localWorkspaceSessionEntry,
  remoteWorkspaceConnectionTarget,
  remoteWorkspaceSessionEntry,
  sameWorkspaceSessionEntry,
  type RemoteWorkspaceTarget,
  type WorkspaceSessionEntry,
} from '#/shared/remote-workspace.ts'
import { parseTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { sameWorkspaceProbeState, type WorkspaceProbeState } from '#/shared/workspace-runtime.ts'
import { nextRestoredWorkspaceIdAfterWorkspaceClose } from '#/web/open-workspace-state.ts'
import { markRemoteLifecycleReady } from '#/web/stores/workspaces/remote-workspace-admission.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import type { WorkspaceSessionProjectionState, WorkspaceState, WorkspacesStore } from '#/web/stores/workspaces/types.ts'

export interface ResolvedWorkspace {
  id: WorkspaceId
  target?: RemoteWorkspaceTarget
  workspaceProbe?: WorkspaceProbeState
  session?: {
    entry: WorkspaceSessionEntry
    projectionState: WorkspaceSessionProjectionState
  }
}

interface OrderedWorkspaceState {
  workspaces: Record<string, WorkspaceState>
  workspaceOrder: WorkspaceId[]
}

interface WorkspaceUpsertResult extends OrderedWorkspaceState {
  changed: boolean
  id: WorkspaceId
}

export function workspaceShellForNewRuntimeEpoch(
  workspace: WorkspaceState,
  workspaceRuntimeId: string,
): WorkspaceState {
  const next: WorkspaceState = {
    ...workspace,
    workspaceRuntimeId,
    capability: { kind: 'probing', probe: { status: 'probing' } },
  }
  if (workspace.admission.kind === 'remote') {
    next.admission = {
      kind: 'remote',
      lifecycle: null,
      lifecycleAttemptId: null,
    }
  }
  return next
}

export function removeWorkspaceFromSessionState(s: WorkspacesStore, id: string): Partial<WorkspacesStore> {
  const workspace = s.workspaces[id]
  if (!workspace) return s
  const workspaces = { ...s.workspaces }
  const selectedTerminalSessionIdByTerminalFilesystemTarget = {
    ...s.selectedTerminalSessionIdByTerminalFilesystemTarget,
  }
  const tabOpenerIdentityByScope = { ...s.tabOpenerIdentityByScope }
  const navigationHistoryByWorkspace = { ...s.navigationHistoryByWorkspace }
  const branchViewModeByWorkspace = { ...s.branchViewModeByWorkspace }
  delete workspaces[id]
  delete branchViewModeByWorkspace[id]
  delete navigationHistoryByWorkspace[id]
  for (const terminalFilesystemTargetKey of Object.keys(selectedTerminalSessionIdByTerminalFilesystemTarget)) {
    const target = parseTerminalFilesystemTargetKey(terminalFilesystemTargetKey)
    if (target?.workspaceId === id) {
      delete selectedTerminalSessionIdByTerminalFilesystemTarget[terminalFilesystemTargetKey]
    }
  }
  for (const scopeKey of Object.keys(tabOpenerIdentityByScope)) {
    if (scopeKey.startsWith(`${id}\0`)) delete tabOpenerIdentityByScope[scopeKey]
  }
  const workspaceOrder = s.workspaceOrder.filter((workspaceId) => workspaceId !== id)
  const restoredWorkspaceId = nextRestoredWorkspaceIdAfterWorkspaceClose(
    s.workspaceOrder,
    s.restoredWorkspaceId,
    workspace.id,
  )
  const restoredClientWorkspaceBaseline = s.restoredClientWorkspaceBaseline
    ? {
        ...s.restoredClientWorkspaceBaseline,
        preferredWorkspacePaneTabByTargetByWorkspace: recordWithoutKey(
          s.restoredClientWorkspaceBaseline.preferredWorkspacePaneTabByTargetByWorkspace,
          id,
        ),
        branchViewModeByWorkspace: recordWithoutKey(s.restoredClientWorkspaceBaseline.branchViewModeByWorkspace, id),
        filetreeViewStateByFilesystemTargetByWorkspace: recordWithoutKey(
          s.restoredClientWorkspaceBaseline.filetreeViewStateByFilesystemTargetByWorkspace,
          id,
        ),
        selectedTerminalSessionIdByTerminalFilesystemTarget: Object.fromEntries(
          Object.entries(s.restoredClientWorkspaceBaseline.selectedTerminalSessionIdByTerminalFilesystemTarget).filter(
            ([key]) => parseTerminalFilesystemTargetKey(key)?.workspaceId !== id,
          ),
        ),
      }
    : null
  return {
    workspaces,
    selectedTerminalSessionIdByTerminalFilesystemTarget,
    tabOpenerIdentityByScope,
    navigationHistoryByWorkspace,
    branchViewModeByWorkspace,
    workspaceOrder,
    restoredWorkspaceId,
    restoredClientWorkspaceBaseline,
  }
}

function orderedInsert(
  workspaceOrder: WorkspaceId[],
  id: WorkspaceId,
  rankById?: ReadonlyMap<string, number>,
): WorkspaceId[] {
  if (!rankById) return [...workspaceOrder, id]
  const rank = rankById.get(id)
  if (rank === undefined) return [...workspaceOrder, id]
  const next = [...workspaceOrder]
  const index = next.findIndex((existing) => {
    const existingRank = rankById.get(existing)
    return existingRank !== undefined && existingRank > rank
  })
  next.splice(index === -1 ? next.length : index, 0, id)
  return next
}

function sessionEntryForResolvedWorkspace(resolvedWorkspace: ResolvedWorkspace): WorkspaceSessionEntry {
  return (
    resolvedWorkspace.session?.entry ??
    (resolvedWorkspace.target
      ? remoteWorkspaceSessionEntry(resolvedWorkspace.target)
      : localWorkspaceSessionEntry(resolvedWorkspace.id))
  )
}

function sessionProjectionStateForResolvedWorkspace(
  resolvedWorkspace: ResolvedWorkspace,
): WorkspaceSessionProjectionState {
  return resolvedWorkspace.session?.projectionState ?? 'projected'
}

function capabilityAcrossRuntimeTransition(
  workspace: WorkspaceState,
  workspaceRuntimeId: string,
): WorkspaceState['capability'] {
  return workspace.workspaceRuntimeId === workspaceRuntimeId
    ? workspace.capability
    : { kind: 'probing', probe: { status: 'probing' } }
}

function remoteTargetsEqual(
  left: RemoteWorkspaceTarget | undefined | null,
  right: RemoteWorkspaceTarget | undefined,
): boolean {
  if (!left || !right) return false
  return (
    left.alias === right.alias &&
    left.host === right.host &&
    left.user === right.user &&
    left.port === right.port &&
    left.remotePath === right.remotePath &&
    left.displayName === right.displayName
  )
}

function upsertWorkspace(
  state: OrderedWorkspaceState,
  id: WorkspaceId,
  options: {
    rankById?: ReadonlyMap<string, number>
    create: () => WorkspaceState
    update?: (existing: WorkspaceState) => WorkspaceState | null
  },
): WorkspaceUpsertResult {
  const existing = state.workspaces[id]
  if (existing) {
    if (!options.update) {
      return { workspaces: state.workspaces, workspaceOrder: state.workspaceOrder, changed: false, id }
    }
    const updated = options.update(existing)
    if (!updated) {
      return { workspaces: state.workspaces, workspaceOrder: state.workspaceOrder, changed: false, id }
    }
    return {
      workspaces: { ...state.workspaces, [id]: updated },
      workspaceOrder: state.workspaceOrder,
      changed: true,
      id,
    }
  }
  return {
    workspaces: { ...state.workspaces, [id]: options.create() },
    workspaceOrder: orderedInsert(state.workspaceOrder, id, options.rankById),
    changed: true,
    id,
  }
}

export function addResolvedWorkspace(
  state: OrderedWorkspaceState,
  resolvedWorkspace: ResolvedWorkspace,
  workspaceRuntimeId: string,
  rankById?: ReadonlyMap<string, number>,
): WorkspaceUpsertResult {
  return upsertWorkspace(state, resolvedWorkspace.id, {
    rankById,
    create: () => {
      const workspace = emptyWorkspace(resolvedWorkspace.id, workspaceRuntimeId)
      workspace.session = {
        entry: sessionEntryForResolvedWorkspace(resolvedWorkspace),
        projectionState: sessionProjectionStateForResolvedWorkspace(resolvedWorkspace),
      }
      // Local resolves carry no target, so the empty shell keeps a null lifecycle.
      // A resolved remote target is authoritative and settles the shell to ready.
      if (resolvedWorkspace.workspaceProbe) {
        acceptWorkspaceProbeState(workspace, resolvedWorkspace.workspaceProbe)
      }
      if (resolvedWorkspace.target) markRemoteLifecycleReady(workspace, resolvedWorkspace.target)
      return workspace
    },
    update: (existing) => {
      const runtimeChanged = existing.workspaceRuntimeId !== workspaceRuntimeId
      const sessionEntry = sessionEntryForResolvedWorkspace(resolvedWorkspace)
      const sessionProjectionState = sessionProjectionStateForResolvedWorkspace(resolvedWorkspace)
      const sessionChanged =
        existing.session.projectionState !== sessionProjectionState ||
        !sameWorkspaceSessionEntry(existing.session.entry, sessionEntry)
      const workspaceProbeChanged =
        !!resolvedWorkspace.workspaceProbe &&
        !sameWorkspaceProbeState(existing.capability.probe, resolvedWorkspace.workspaceProbe)
      if (!resolvedWorkspace.target) {
        if (!runtimeChanged && !sessionChanged && !workspaceProbeChanged) return null
        const next: WorkspaceState = {
          ...existing,
          workspaceRuntimeId: runtimeChanged ? workspaceRuntimeId : existing.workspaceRuntimeId,
          session: {
            entry: sessionEntry,
            projectionState: sessionProjectionState,
          },
          capability: capabilityAcrossRuntimeTransition(existing, workspaceRuntimeId),
        }
        if (resolvedWorkspace.workspaceProbe) acceptWorkspaceProbeState(next, resolvedWorkspace.workspaceProbe)
        return next
      }
      const lifecycleReady = existing.admission.kind === 'remote' && existing.admission.lifecycle?.kind === 'ready'
      const targetChanged = !remoteTargetsEqual(
        existing.admission.kind === 'remote' ? remoteWorkspaceConnectionTarget(existing.admission.lifecycle) : null,
        resolvedWorkspace.target,
      )
      if (!runtimeChanged && !sessionChanged && !workspaceProbeChanged && lifecycleReady && !targetChanged) {
        return null
      }
      // A converged remote result promotes connecting or failed shells even when
      // the retained target is unchanged; target equality does not imply readiness.
      const next: WorkspaceState = {
        ...existing,
        workspaceRuntimeId: runtimeChanged ? workspaceRuntimeId : existing.workspaceRuntimeId,
        session: {
          entry: sessionEntry,
          projectionState: sessionProjectionState,
        },
        capability: capabilityAcrossRuntimeTransition(existing, workspaceRuntimeId),
        admission:
          existing.admission.kind === 'remote'
            ? {
                kind: 'remote',
                lifecycle: existing.admission.lifecycle,
                lifecycleAttemptId: existing.admission.lifecycleAttemptId,
              }
            : existing.admission,
      }
      if (resolvedWorkspace.workspaceProbe) acceptWorkspaceProbeState(next, resolvedWorkspace.workspaceProbe)
      markRemoteLifecycleReady(next, resolvedWorkspace.target)
      return next
    },
  })
}

export function insertPlaceholderWorkspace(
  state: OrderedWorkspaceState,
  entry: WorkspaceSessionEntry,
  workspaceRuntimeId: string,
  rankById?: ReadonlyMap<string, number>,
): WorkspaceUpsertResult {
  return upsertWorkspace(state, entry.id, {
    rankById,
    create: () => {
      const workspace = emptyWorkspace(entry.id, workspaceRuntimeId)
      workspace.session = { entry, projectionState: 'projected' }
      // Only the authoritative runtime projection may settle this lifecycle.
      return workspace
    },
  })
}
