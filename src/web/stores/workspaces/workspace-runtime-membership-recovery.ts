import { disposeRepoOperationScheduler } from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import { cancelWorkspaceCapabilityRefreshes } from '#/web/workspaces/runtime/capability-refresh.ts'
import { reconcileWorkspaceRuntimeMemberships } from '#/web/workspaces/client.ts'
import { invalidateWorkspaceRuntimes } from '#/web/workspaces/runtime/query.ts'
import { clearWorkspacePaneTabsProjectionState } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacesLog } from '#/web/logger.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { appQueryClient } from '#/web/app/query-client.ts'
import { disposeRepoRuntimeReadState } from '#/web/repos/query-runtime.ts'
import { repoDataQueryKey } from '#/web/repos/query-keys.ts'
import { runRemoteWorkspaceConnection } from '#/web/stores/workspaces/remote-workspace-connection-command.ts'
import { runWorkspaceRefresh } from '#/web/stores/workspaces/workspace-refresh-command.ts'
import {
  acceptRemoteWorkspaceLifecycleSnapshot,
  acceptRemoteWorkspaceRuntimeProjection,
} from '#/web/stores/workspaces/remote-workspace-lifecycle-projection.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import { isRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import {
  removeWorkspaceFromSessionState,
  workspaceShellForReconciledRuntimeEpoch,
} from '#/web/stores/workspaces/workspace-session-state.ts'
import { runExclusiveWorkspaceRuntimeMembershipCommand } from '#/web/stores/workspaces/workspace-runtime-membership-scheduler.ts'

export type WorkspaceRuntimeMembershipRecoveryResult =
  | {
      kind: 'settled'
      targets: Array<{ workspaceId: WorkspaceId; workspaceRuntimeId: string }>
    }
  | { kind: 'superseded' }

type SettledWorkspaceRuntimeMembershipRecovery = Extract<WorkspaceRuntimeMembershipRecoveryResult, { kind: 'settled' }>
type ChangedWorkspaceRuntimeTarget = {
  workspaceId: WorkspaceId
  previousWorkspaceRuntimeId: string
  workspaceRuntimeId: string
}
type RetiredWorkspaceRuntimeTarget = {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
}
type CapturedWorkspaceRuntimeMembershipRecovery = SettledWorkspaceRuntimeMembershipRecovery & {
  changedTargets: ChangedWorkspaceRuntimeTarget[]
  remoteEnsureTargets: Array<{ workspaceId: WorkspaceId; workspaceRuntimeId: string }>
}
type ReconciledWorkspaceRuntimeMembershipRecovery = CapturedWorkspaceRuntimeMembershipRecovery | { kind: 'superseded' }
type WorkspaceRuntimeRecoveryTarget = SettledWorkspaceRuntimeMembershipRecovery['targets'][number]

/**
 * Re-declares this window's complete workspace membership after realtime recovery,
 * then atomically advances every still-current shell to the server's canonical
 * runtime epoch. Changed targets and local targets left probing by an earlier
 * interrupted recovery remain eligible for downstream projection recovery only
 * after their one-shot capability command succeeds.
 *
 * Capability commands stay outside membership admission. #359 accepts that
 * overlapping recovery may project a settling epoch instead of adding generation joining.
 */
export async function reconcileOpenWorkspaceRuntimeMemberships(
  set: WorkspacesSet,
  get: WorkspacesGet,
): Promise<WorkspaceRuntimeMembershipRecoveryResult> {
  const recovery = await runExclusiveWorkspaceRuntimeMembershipCommand(() =>
    reconcileOpenWorkspaceRuntimeMembershipsNow(set, get),
  )
  if (recovery.kind === 'superseded') return recovery
  const changedRemoteWorkspaceIds = new Set(
    recovery.changedTargets
      .filter((target) => isRemoteWorkspaceId(target.workspaceId))
      .map((target) => target.workspaceId),
  )
  void Promise.all(
    recovery.remoteEnsureTargets
      .filter((target) => !changedRemoteWorkspaceIds.has(target.workspaceId))
      .map(async (target) => {
        await runRemoteWorkspaceConnection(set, get, target.workspaceId, {
          workspaceRuntimeId: target.workspaceRuntimeId,
          mode: 'ensure',
        })
      }),
  ).catch((err) => {
    workspacesLog.warn('failed to ensure remote lifecycle after runtime membership recovery', { err })
  })
  const remoteEnsureWorkspaceIds = new Set(recovery.remoteEnsureTargets.map((target) => target.workspaceId))
  const changedWorkspaceIds = new Set(recovery.changedTargets.map((target) => target.workspaceId))
  const settlementTargets = recovery.targets.filter((target) => {
    if (changedWorkspaceIds.has(target.workspaceId)) return true
    const workspace = get().workspaces[target.workspaceId]
    return (
      !isRemoteWorkspaceId(target.workspaceId) &&
      workspace?.workspaceRuntimeId === target.workspaceRuntimeId &&
      workspace.capability.kind === 'probing'
    )
  })
  // Settle one batch before projection recovery. #359 accepts cross-workspace
  // delay instead of adding per-target generation coordination.
  const settlementEligibility = await Promise.all(
    settlementTargets.map(async (target) => ({
      workspaceId: target.workspaceId,
      eligible: await settleWorkspaceRuntimeForProjection(
        set,
        get,
        target,
        remoteEnsureWorkspaceIds.has(target.workspaceId),
      ),
    })),
  )
  const ineligibleWorkspaceIds = new Set(
    settlementEligibility.filter((target) => !target.eligible).map((target) => target.workspaceId),
  )
  return {
    kind: 'settled',
    targets: recovery.targets.filter((target) => !ineligibleWorkspaceIds.has(target.workspaceId)),
  }
}

async function settleWorkspaceRuntimeForProjection(
  set: WorkspacesSet,
  get: WorkspacesGet,
  target: WorkspaceRuntimeRecoveryTarget,
  remoteEnsureRequired: boolean,
): Promise<boolean> {
  if (isRemoteWorkspaceId(target.workspaceId)) {
    if (remoteEnsureRequired) {
      const outcome = await runRemoteWorkspaceConnection(set, get, target.workspaceId, {
        workspaceRuntimeId: target.workspaceRuntimeId,
        mode: 'ensure',
      })
      return outcome?.kind === 'ready'
    }
    const workspace = get().workspaces[target.workspaceId]
    return (
      workspace?.workspaceRuntimeId === target.workspaceRuntimeId &&
      workspace.admission.kind === 'remote' &&
      workspace.admission.lifecycle?.kind === 'ready'
    )
  }

  try {
    const outcome = await runWorkspaceRefresh({ set, get }, target.workspaceId, {
      workspaceRuntimeId: target.workspaceRuntimeId,
    })
    if (outcome.ok) return true
    if (outcome.kind === 'cancelled') return false
    workspacesLog.warn('workspace refresh did not settle the local runtime for projection recovery', {
      workspaceId: target.workspaceId,
      workspaceRuntimeId: target.workspaceRuntimeId,
      message: outcome.message,
    })
    return false
  } catch (err) {
    workspacesLog.warn('workspace refresh failed while settling the local runtime for projection recovery', {
      workspaceId: target.workspaceId,
      workspaceRuntimeId: target.workspaceRuntimeId,
      err,
    })
    return false
  }
}

async function reconcileOpenWorkspaceRuntimeMembershipsNow(
  set: WorkspacesSet,
  get: WorkspacesGet,
): Promise<ReconciledWorkspaceRuntimeMembershipRecovery> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const capturedRecovery = await reconcileCapturedWorkspaceRuntimeMemberships(set, get)
    if (capturedRecovery) {
      return {
        kind: 'settled',
        targets: capturedRecovery.targets,
        changedTargets: capturedRecovery.changedTargets,
        remoteEnsureTargets: capturedRecovery.remoteEnsureTargets,
      }
    }
  }
  return { kind: 'superseded' }
}

async function reconcileCapturedWorkspaceRuntimeMemberships(
  set: WorkspacesSet,
  get: WorkspacesGet,
): Promise<CapturedWorkspaceRuntimeMembershipRecovery | null> {
  const captured = Object.values(get().workspaces).map((workspace) => ({
    workspaceId: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
  }))
  const response = await reconcileWorkspaceRuntimeMemberships(captured.map((entry) => entry.workspaceId))
  const runtimeByWorkspaceId = new Map(response.runtimes.map((entry) => [entry.workspaceId, entry]))
  const currentWorkspaceIds = Object.values(get().workspaces).map((workspace) => workspace.id)
  if (
    !sameWorkspaceIdSet(
      currentWorkspaceIds,
      captured.map((entry) => entry.workspaceId),
    )
  )
    return null
  const changedTargets: ChangedWorkspaceRuntimeTarget[] = []
  const retiredTargets: RetiredWorkspaceRuntimeTarget[] = []

  set((state) => {
    let nextState = state
    for (const previous of captured) {
      const current = nextState.workspaces[previous.workspaceId]
      const runtime = runtimeByWorkspaceId.get(previous.workspaceId)
      if (!current || current.workspaceRuntimeId !== previous.workspaceRuntimeId) continue
      if (!runtime) {
        nextState = { ...nextState, ...removeWorkspaceFromSessionState(nextState, previous.workspaceId) }
        retiredTargets.push(previous)
        continue
      }
      if (runtime.workspaceRuntimeId === previous.workspaceRuntimeId) continue
      nextState = {
        ...nextState,
        workspaces: {
          ...nextState.workspaces,
          [previous.workspaceId]: workspaceShellForReconciledRuntimeEpoch(
            current,
            runtime.workspaceRuntimeId,
            runtime.workspaceProbe,
          ),
        },
      }
      retiredTargets.push(previous)
      changedTargets.push({
        workspaceId: previous.workspaceId,
        previousWorkspaceRuntimeId: previous.workspaceRuntimeId,
        workspaceRuntimeId: runtime.workspaceRuntimeId,
      })
    }
    return nextState
  })

  for (const retired of retiredTargets) {
    cancelWorkspaceCapabilityRefreshes(retired.workspaceId, retired.workspaceRuntimeId)
    disposeRepoOperationScheduler(retired.workspaceId)
    clearWorkspacePaneTabsProjectionState(retired.workspaceId, retired.workspaceRuntimeId)
    appQueryClient.removeQueries({
      queryKey: repoDataQueryKey(retired.workspaceId, retired.workspaceRuntimeId),
    })
    disposeRepoRuntimeReadState(retired.workspaceId, retired.workspaceRuntimeId)
  }
  for (const changed of changedTargets) {
    if (!isRemoteWorkspaceId(changed.workspaceId)) continue
    const runtime = runtimeByWorkspaceId.get(changed.workspaceId)
    if (runtime) acceptRemoteWorkspaceRuntimeProjection(set, get, runtime)
  }
  try {
    const runtimeSnapshot = await invalidateWorkspaceRuntimes()
    acceptRemoteWorkspaceLifecycleSnapshot(set, get, runtimeSnapshot)
  } catch (err) {
    workspacesLog.warn('failed to refresh the complete runtime snapshot after membership recovery', { err })
  }

  const currentWorkspaces = get().workspaces
  const targets: SettledWorkspaceRuntimeMembershipRecovery['targets'] = []
  const remoteEnsureTargets: Array<{ workspaceId: WorkspaceId; workspaceRuntimeId: string }> = []
  for (const { workspaceId } of captured) {
    const currentWorkspace = currentWorkspaces[workspaceId]
    const runtime = runtimeByWorkspaceId.get(workspaceId)
    if (!currentWorkspace || !runtime || currentWorkspace.workspaceRuntimeId !== runtime.workspaceRuntimeId) continue
    const target = { workspaceId, workspaceRuntimeId: currentWorkspace.workspaceRuntimeId }
    targets.push(target)

    const lifecycleKind = runtime.remoteLifecycle?.kind
    if (isRemoteWorkspaceId(workspaceId) && (lifecycleKind === 'idle' || lifecycleKind === 'connecting')) {
      remoteEnsureTargets.push({ workspaceId, workspaceRuntimeId: runtime.workspaceRuntimeId })
    }
  }

  return {
    kind: 'settled',
    targets,
    changedTargets,
    remoteEnsureTargets,
  }
}

function sameWorkspaceIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((workspaceId) => rightSet.has(workspaceId))
}
