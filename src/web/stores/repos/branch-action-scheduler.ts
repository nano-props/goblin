import type { RepoBranchActionKind } from '#/web/stores/repos/branch-action-types.ts'
import type { RepoOperationPhase } from '#/web/stores/repos/operations.ts'
export interface BranchActionScheduleInput {
  actionKind: RepoBranchActionKind
  fetchBusy: boolean
  branchOperationPhase: RepoOperationPhase
  coreRefreshBusy: boolean
}

export interface BranchActionScheduleDecision {
  blockedMessage?: string
}

export function isNetworkBranchActionKind(kind: RepoBranchActionKind): boolean {
  return kind === 'pull' || kind === 'push'
}

export function evaluateBranchActionSchedule(input: BranchActionScheduleInput): BranchActionScheduleDecision {
  const network = isNetworkBranchActionKind(input.actionKind)
  const replacingQueuedNetworkAction = network && input.branchOperationPhase === 'queued'
  const fetchBlocked = !replacingQueuedNetworkAction && input.fetchBusy

  if (fetchBlocked) {
    return {
      blockedMessage: 'error.network-op-in-progress',
    }
  }

  return {}
}
