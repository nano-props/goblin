import { disposeRepoOperationScheduler } from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import { cancelWorkspaceCapabilityRefreshes } from '#/web/workspace-capability-refresh.ts'
import { reconcileWorkspaceRuntimeMemberships } from '#/web/workspace-client.ts'
import { invalidateWorkspaceRuntimes } from '#/web/workspace-runtime-query.ts'
import { clearWorkspacePaneTabsProjectionState } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacesLog } from '#/web/logger.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { disposeRepoRuntimeReadState } from '#/web/repo-query-runtime.ts'
import { repoDataQueryKey } from '#/web/repo-query-keys.ts'
import { runRemoteWorkspaceConnection } from '#/web/stores/workspaces/remote-workspace-connection-command.ts'
import { runWorkspaceRefresh } from '#/web/stores/workspaces/workspace-refresh-command.ts'
import {
  acceptRemoteWorkspaceLifecycleSnapshot,
  acceptRemoteWorkspaceRuntimeProjection,
} from '#/web/stores/workspaces/remote-workspace-lifecycle-projection.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import { isRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import { workspaceShellForReconciledRuntimeEpoch } from '#/web/stores/workspaces/workspace-session-state.ts'
import { runExclusiveWorkspaceRuntimeMembershipCommand } from '#/web/stores/workspaces/workspace-runtime-membership-scheduler.ts'

export type WorkspaceRuntimeMembershipRecoveryResult =
  | {
      kind: 'settled'
      targets: Array<{ workspaceId: WorkspaceId; workspaceRuntimeId: string }>
      changedTargets: Array<{
        workspaceId: WorkspaceId
        previousWorkspaceRuntimeId: string
        workspaceRuntimeId: string
      }>
    }
  | { kind: 'superseded' }

type SettledWorkspaceRuntimeMembershipRecovery = Extract<WorkspaceRuntimeMembershipRecoveryResult, { kind: 'settled' }>
type ReconciledWorkspaceRuntimeMembershipRecovery = WorkspaceRuntimeMembershipRecoveryResult & {
  remoteEnsureTargets?: Array<{ workspaceId: WorkspaceId; workspaceRuntimeId: string }>
}
type CapturedWorkspaceRuntimeMembershipRecovery = SettledWorkspaceRuntimeMembershipRecovery & {
  remoteEnsureTargets: Array<{ workspaceId: WorkspaceId; workspaceRuntimeId: string }>
}
type ChangedWorkspaceRuntimeTarget = SettledWorkspaceRuntimeMembershipRecovery['changedTargets'][number]

/**
 * Re-declares this window's complete workspace membership after realtime recovery,
 * then atomically advances every still-current shell to the server's canonical
 * runtime epoch. Changed targets remain eligible for downstream projection
 * recovery only after their one-shot capability command succeeds.
 *
 * Capability commands stay outside membership admission. #359 accepts that
 * overlapping recovery may project a settling epoch instead of adding generation joining.
 */
export async function reconcileOpenWorkspaceRuntimeMemberships(
  set: WorkspacesSet,
  get: WorkspacesGet,
): Promise<WorkspaceRuntimeMembershipRecoveryResult> {
  const recovery = await runExclusiveWorkspaceRuntimeMembershipCommand(
    async () => await reconcileOpenWorkspaceRuntimeMembershipsNow(set, get),
  )
  if (recovery.kind === 'superseded') return recovery
  const changedRemoteWorkspaceIds = new Set(
    recovery.changedTargets
      .filter((target) => isRemoteWorkspaceId(target.workspaceId))
      .map((target) => target.workspaceId),
  )
  void Promise.all(
    (recovery.remoteEnsureTargets ?? [])
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
  const remoteEnsureWorkspaceIds = new Set((recovery.remoteEnsureTargets ?? []).map((target) => target.workspaceId))
  // Settle one batch before projection recovery. #359 accepts cross-workspace
  // delay instead of adding per-target generation coordination.
  const changedTargetEligibility = await Promise.all(
    recovery.changedTargets.map(async (target) => ({
      workspaceId: target.workspaceId,
      eligible: await settleChangedWorkspaceRuntimeForProjection(
        set,
        get,
        target,
        remoteEnsureWorkspaceIds.has(target.workspaceId),
      ),
    })),
  )
  const ineligibleWorkspaceIds = new Set(
    changedTargetEligibility.filter((target) => !target.eligible).map((target) => target.workspaceId),
  )
  return {
    kind: 'settled',
    targets: recovery.targets.filter((target) => !ineligibleWorkspaceIds.has(target.workspaceId)),
    changedTargets: recovery.changedTargets,
  }
}

async function settleChangedWorkspaceRuntimeForProjection(
  set: WorkspacesSet,
  get: WorkspacesGet,
  target: ChangedWorkspaceRuntimeTarget,
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
    if ('cancelled' in outcome) return false
    workspacesLog.warn('workspace refresh did not recover the changed local runtime', {
      workspaceId: target.workspaceId,
      workspaceRuntimeId: target.workspaceRuntimeId,
      message: outcome.message,
    })
    return false
  } catch (err) {
    workspacesLog.warn('workspace refresh failed after local runtime epoch replacement', {
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
  const runtimeSnapshot = await invalidateWorkspaceRuntimes()
  const currentWorkspaceIds = Object.values(get().workspaces).map((workspace) => workspace.id)
  if (
    !sameWorkspaceIdSet(
      currentWorkspaceIds,
      captured.map((entry) => entry.workspaceId),
    )
  )
    return null
  const changedTargets: SettledWorkspaceRuntimeMembershipRecovery['changedTargets'] = []

  set((state) => {
    let workspaces = state.workspaces
    for (const previous of captured) {
      const current = workspaces[previous.workspaceId]
      const runtime = runtimeByWorkspaceId.get(previous.workspaceId)
      if (!current || current.workspaceRuntimeId !== previous.workspaceRuntimeId || !runtime) continue
      if (runtime.workspaceRuntimeId === previous.workspaceRuntimeId) continue
      if (workspaces === state.workspaces) workspaces = { ...state.workspaces }
      workspaces[previous.workspaceId] = workspaceShellForReconciledRuntimeEpoch(
        current,
        runtime.workspaceRuntimeId,
        runtime.workspaceProbe,
      )
      changedTargets.push({
        workspaceId: previous.workspaceId,
        previousWorkspaceRuntimeId: previous.workspaceRuntimeId,
        workspaceRuntimeId: runtime.workspaceRuntimeId,
      })
    }
    return workspaces === state.workspaces ? state : { ...state, workspaces }
  })

  for (const changed of changedTargets) {
    cancelWorkspaceCapabilityRefreshes(changed.workspaceId, changed.previousWorkspaceRuntimeId)
    disposeRepoOperationScheduler(changed.workspaceId)
    clearWorkspacePaneTabsProjectionState(changed.workspaceId, changed.previousWorkspaceRuntimeId)
    appQueryClient.removeQueries({
      queryKey: repoDataQueryKey(changed.workspaceId, changed.previousWorkspaceRuntimeId),
    })
    disposeRepoRuntimeReadState(changed.workspaceId, changed.previousWorkspaceRuntimeId)
  }
  for (const changed of changedTargets) {
    if (!isRemoteWorkspaceId(changed.workspaceId)) continue
    const runtime = runtimeByWorkspaceId.get(changed.workspaceId)
    if (runtime) acceptRemoteWorkspaceRuntimeProjection(set, get, runtime)
  }
  acceptRemoteWorkspaceLifecycleSnapshot(set, get, runtimeSnapshot)

  const currentWorkspaces = get().workspaces
  const targets: SettledWorkspaceRuntimeMembershipRecovery['targets'] = []
  const remoteEnsureTargets: Array<{ workspaceId: WorkspaceId; workspaceRuntimeId: string }> = []
  for (const { workspaceId } of captured) {
    const currentWorkspaceRuntimeId = currentWorkspaces[workspaceId]?.workspaceRuntimeId
    if (!currentWorkspaceRuntimeId) continue
    targets.push({ workspaceId, workspaceRuntimeId: currentWorkspaceRuntimeId })

    const runtime = runtimeByWorkspaceId.get(workspaceId)
    if (
      runtime &&
      isRemoteWorkspaceId(workspaceId) &&
      currentWorkspaceRuntimeId === runtime.workspaceRuntimeId &&
      ['idle', 'connecting'].includes(runtime.remoteLifecycle?.kind ?? '')
    ) {
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
