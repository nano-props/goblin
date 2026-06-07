import type { RepoState } from '#/web/stores/repos/types.ts'
import { repoOperationBusy } from '#/web/stores/repos/runtime.ts'
import { repoBranchActionLoadingLabel, type RepoActionLabel } from '#/web/stores/repos/action-labels.ts'
import { branchActionKindFromReason, isBranchActionReason } from '#/web/stores/repos/operations.ts'
export type RepoActivityKind =
  | 'branch-action'

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

function branchActionActivity(repo: RepoState): RepoActivity | null {
  const action = repo.operations.branchAction
  if (action.phase === 'idle' || !isBranchActionReason(action.reason)) return null
  const label = repoBranchActionLoadingLabel(branchActionKindFromReason(action.reason), action.phase)
  return {
    kind: 'branch-action',
    labelKey: label.labelKey,
    labelParams: label.labelParams,
  }
}

export function getRepoActivity(repo: RepoState): RepoActivity | null {
  return branchActionActivity(repo)
}

export function isRepoPrimaryRefreshBusy(repo: RepoState): boolean {
  // Must match canStartRemoteFetch guards (minus branchAction, which has its
  // own activity indicator) so the button stays busy through the entire sync
  // pipeline — fetch + refreshAll (snapshot + status) — not just the fetch.
  return (
    repoOperationBusy(repo.id, 'fetch') ||
    repoOperationBusy(repo.id, 'snapshot') ||
    repoOperationBusy(repo.id, 'status')
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
