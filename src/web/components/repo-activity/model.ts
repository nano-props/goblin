import type { RepoState } from '#/web/stores/repos/types.ts'
import { repoLocalPrimaryRefreshBusy } from '#/web/stores/repos/repo-operation-scheduler.ts'
import { repoBranchActionLoadingLabel, type RepoActionLabel } from '#/web/stores/repos/action-labels.ts'
import { branchActionKindFromReason, isBranchActionReason } from '#/web/stores/repos/operations.ts'
import { repoServerOperationActive } from '#/web/repo-data-query.ts'
import { projectBranchActionOperation } from '#/web/hooks/branch-action-state.ts'
import type { RepoOperationsSnapshot } from '#/shared/api-types.ts'
type RepoActivityKind = 'branch-action'

export interface RepoActivity {
  kind: RepoActivityKind
  labelKey: string
  labelParams?: Record<string, string | number>
}

export interface RepoCompletion extends RepoActionLabel {
  id: number
}

export type RepoActivityControlView =
  | { kind: 'activity'; activity: RepoActivity }
  | { kind: 'completion'; completion: RepoCompletion }
  | { kind: 'refresh-button'; manualSyncBusy: boolean }

function branchActionActivity(repo: RepoState, serverOperations?: RepoOperationsSnapshot): RepoActivity | null {
  const action = projectBranchActionOperation(repo, serverOperations?.operations)
  if (action.phase === 'idle' || !isBranchActionReason(action.reason)) return null
  const label = repoBranchActionLoadingLabel(branchActionKindFromReason(action.reason), action.phase)
  return {
    kind: 'branch-action',
    labelKey: label.labelKey,
    labelParams: label.labelParams,
  }
}

export function getRepoActivity(repo: RepoState, serverOperations?: RepoOperationsSnapshot): RepoActivity | null {
  return branchActionActivity(repo, serverOperations)
}

export function repoOperationsSnapshotHasPrimaryRefresh(snapshot: RepoOperationsSnapshot | undefined): boolean {
  return !!snapshot?.operations.some((operation) => operation.kind === 'fetch' && repoServerOperationActive(operation))
}

export function isRepoPrimaryRefreshBusy(
  repo: RepoState,
  serverOperations?: RepoOperationsSnapshot,
): boolean {
  return (
    repoOperationsSnapshotHasPrimaryRefresh(serverOperations) ||
    repoLocalPrimaryRefreshBusy(repo.id)
  )
}

export function getRepoActivityControlView(input: {
  visibleActivity: RepoActivity | null
  completion: RepoCompletion | null
  manualSyncBusy: boolean
}): RepoActivityControlView {
  if (input.visibleActivity?.kind === 'branch-action') return { kind: 'activity', activity: input.visibleActivity }
  if (input.completion) return { kind: 'completion', completion: input.completion }
  if (input.visibleActivity) return { kind: 'activity', activity: input.visibleActivity }
  return { kind: 'refresh-button', manualSyncBusy: input.manualSyncBusy }
}
