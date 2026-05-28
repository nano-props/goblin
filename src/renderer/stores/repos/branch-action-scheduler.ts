import type { RepoBranchActionKind } from '#/renderer/stores/repos/branch-action-types.ts'
import type { RepoOperationPhase, RepoOperationReason } from '#/renderer/stores/repos/operations.ts'

export interface BranchActionScheduleInput {
  actionKind: RepoBranchActionKind
  fetchBusy: boolean
  fetchOperationPhase: RepoOperationPhase
  fetchOperationReason: RepoOperationReason | null
  branchOperationPhase: RepoOperationPhase
  coreRefreshBusy: boolean
}

export interface BranchActionScheduleDecision {
  blockedMessage?: string
  shouldAbortBackgroundFetch: boolean
  waitForBackgroundFetch: boolean
}

export function isNetworkBranchActionKind(kind: RepoBranchActionKind): boolean {
  return kind === 'pull' || kind === 'push'
}

export function evaluateBranchActionSchedule(input: BranchActionScheduleInput): BranchActionScheduleDecision {
  const network = isNetworkBranchActionKind(input.actionKind)
  const replacingQueuedNetworkAction = network && input.branchOperationPhase === 'queued'
  const backgroundFetchBlocked =
    !replacingQueuedNetworkAction &&
    input.fetchOperationPhase === 'running' &&
    input.fetchOperationReason === 'background-fetch'
  const fetchBlocked = !replacingQueuedNetworkAction && input.fetchBusy && !backgroundFetchBlocked

  if (fetchBlocked) {
    return {
      blockedMessage: 'error.network-op-in-progress',
      shouldAbortBackgroundFetch: false,
      waitForBackgroundFetch: false,
    }
  }

  return {
    shouldAbortBackgroundFetch: backgroundFetchBlocked,
    waitForBackgroundFetch: backgroundFetchBlocked && !network,
  }
}
