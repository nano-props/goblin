import { runExclusiveOperation, runLatestOperation } from '#/web/stores/workspaces/operation-runner.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { RepoOperationCancelledError } from '#/web/stores/workspaces/operation-cancellation.ts'
import type {
  RepoBranchActionReason,
  RepoOperationReason,
  RepoOperationTarget,
} from '#/web/stores/workspaces/operations.ts'
import {
  updateIfFresh,
  workspaceCanExecute,
  workspaceOperationalFailureReason,
} from '#/web/stores/workspaces/workspace-guards.ts'
import { repoOperation, repoLocalBranchActionScheduleGuard } from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import type {
  RepoBranchAction,
  RepoBranchActionKind,
  RunBranchActionOptions,
} from '#/web/stores/workspaces/branch-action-types.ts'
import {
  evaluateBranchActionSchedule as evaluateBranchActionScheduleDecision,
  isNetworkBranchActionKind,
} from '#/web/stores/workspaces/branch-action-scheduler.ts'
import type { RepoEventAction, WorkspaceState, WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import type { ExecResult } from '#/web/types.ts'
import {
  createRepoWorktree,
  deleteRepoBranch,
  pullRepoBranch,
  pushRepoBranch,
  removeRepoWorktree,
} from '#/web/repo-client.ts'
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'
import { isGitWorkspace } from '#/web/stores/workspaces/git-workspace-client-state.ts'
const BRANCH_NETWORK_OPERATION_KEY = 'branch-network-action'
const BRANCH_ACTION_WAIT_TIMEOUT_MS = 30_000
const BRANCH_ACTION_WAIT_TIMEOUT_MESSAGE = 'error.branch-action-wait-timeout'
const BRANCH_ACTION_REASON_BY_KIND: Record<RepoBranchActionKind, RepoBranchActionReason> = {
  pull: 'branch:pull',
  push: 'branch:push',
  createWorktree: 'branch:createWorktree',
  deleteBranch: 'branch:deleteBranch',
  removeWorktree: 'branch:removeWorktree',
}
type NetworkRepoBranchAction = Extract<RepoBranchAction, { kind: 'pull' | 'push' }>
type NetworkFetchReason = Extract<RepoOperationReason, 'pull' | 'push'>
const NETWORK_FETCH_REASON_BY_KIND: Record<NetworkRepoBranchAction['kind'], NetworkFetchReason> = {
  pull: 'pull',
  push: 'push',
}

function repoBranchActionReason(kind: RepoBranchActionKind): RepoBranchActionReason {
  return BRANCH_ACTION_REASON_BY_KIND[kind]
}

function branchActionReason(action: RepoBranchAction): RepoBranchActionReason {
  return repoBranchActionReason(action.kind)
}

function branchActionOperationTarget(action: RepoBranchAction): string | null {
  switch (action.kind) {
    case 'pull':
    case 'push':
    case 'deleteBranch':
    case 'removeWorktree':
      return action.branch
    case 'createWorktree':
      return createWorktreeTargetBranch(action.input)
  }
  const exhaustive: never = action
  return exhaustive
}

function createWorktreeTargetBranch(input: CreateWorktreeInput): string {
  switch (input.mode.kind) {
    case 'newBranch':
      return input.mode.newBranch
    case 'existingBranch':
      return input.mode.branch
    case 'trackRemoteBranch':
      return input.mode.localBranch
  }
  const exhaustive: never = input.mode
  return exhaustive
}

function branchActionEventAction(action: RepoBranchAction): RepoEventAction {
  switch (action.kind) {
    case 'pull':
    case 'push':
    case 'deleteBranch':
      return { kind: action.kind, branch: action.branch }
    case 'createWorktree':
      return {
        kind: action.kind,
        branch: createWorktreeTargetBranch(action.input),
        worktreePath: action.input.worktreePath,
      }
    case 'removeWorktree':
      return {
        kind: action.kind,
        branch: action.branch,
        worktreePath: action.worktreePath,
        deleteBranch: action.deleteBranch,
      }
  }
  const exhaustive: never = action
  return exhaustive
}

function networkFetchReason(action: NetworkRepoBranchAction): NetworkFetchReason {
  return NETWORK_FETCH_REASON_BY_KIND[action.kind]
}

function isNetworkBranchAction(action: RepoBranchAction): action is NetworkRepoBranchAction {
  return isNetworkBranchActionKind(action.kind)
}

function branchActionTarget(action: RepoBranchAction): RepoOperationTarget {
  return {
    key: 'branchAction',
    reason: branchActionReason(action),
    target: branchActionOperationTarget(action),
  }
}

function evaluateRepoBranchActionSchedule(repo: WorkspaceState, action: RepoBranchAction) {
  const guard = repoLocalBranchActionScheduleGuard(repo.id)
  return evaluateBranchActionScheduleDecision({
    actionKind: action.kind,
    fetchBusy: guard.fetchBusy,
    branchOperationPhase: guard.branchOperationPhase,
  })
}

function throwIfStale(get: WorkspacesGet, id: WorkspaceId, workspaceRuntimeId: string): void {
  if (get().workspaces[id]?.workspaceRuntimeId !== workspaceRuntimeId) throw new RepoOperationCancelledError()
}

function branchActionErrorFromResult(result: ExecResult): string | null {
  return !result.ok && result.message !== 'cancelled' ? result.message : null
}

function branchActionErrorResult(message: string): ExecResult {
  return { ok: false, message }
}

function shouldSuppressBranchActionResultMessage(result: ExecResult, options?: RunBranchActionOptions): boolean {
  if (result.message === 'cancelled') return true
  if (options?.deferResultMessages?.includes(result.message)) return true
  return false
}

function runBranchActionIpc(
  action: RepoBranchAction,
  repoId: WorkspaceId,
  workspaceRuntimeId: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  switch (action.kind) {
    case 'pull':
      return pullRepoBranch(repoId, workspaceRuntimeId, action.branch, action.worktreePath, signal)
    case 'push':
      return pushRepoBranch(repoId, workspaceRuntimeId, action.branch, signal)
    case 'createWorktree':
      return createRepoWorktree(repoId, workspaceRuntimeId, action.input, action.worktreeBootstrap, signal)
    case 'deleteBranch':
      return deleteRepoBranch(
        repoId,
        workspaceRuntimeId,
        action.branch,
        { force: action.force, deleteUpstream: action.deleteUpstream },
        signal,
      )
    case 'removeWorktree':
      return removeRepoWorktree(
        repoId,
        workspaceRuntimeId,
        {
          branch: action.branch,
          worktreePath: action.worktreePath,
          deleteBranch: action.deleteBranch,
          forceDeleteBranch: action.forceDeleteBranch,
          deleteUpstream: action.deleteUpstream,
        },
        signal,
      )
  }
  const exhaustive: never = action
  return exhaustive
}

export function createBranchActions(set: WorkspacesSet, get: WorkspacesGet) {
  return {
    submitBranchAction(id: WorkspaceId, action: RepoBranchAction, options?: RunBranchActionOptions): void {
      const repo = get().workspaces[id]
      const workspaceRuntimeId = options?.workspaceRuntimeId ?? repo?.workspaceRuntimeId
      if (!repo || repo.workspaceRuntimeId !== workspaceRuntimeId || !isGitWorkspace(repo)) return
      void get().runBranchAction(id, action, options)
    },

    async runBranchAction(
      id: WorkspaceId,
      action: RepoBranchAction,
      options?: RunBranchActionOptions,
    ): Promise<ExecResult | null> {
      const repoBefore = get().workspaces[id]
      if (!repoBefore || !isGitWorkspace(repoBefore)) return null
      const workspaceRuntimeId = options?.workspaceRuntimeId ?? repoBefore.workspaceRuntimeId
      if (repoBefore.workspaceRuntimeId !== workspaceRuntimeId) return null
      const network = isNetworkBranchAction(action)
      const branchOperation = repoOperation(id, 'branchAction')
      const operationalFailureReason = workspaceOperationalFailureReason(repoBefore)
      if (operationalFailureReason) return { ok: false, message: operationalFailureReason }
      if (!workspaceCanExecute(repoBefore)) return { ok: false, message: 'cancelled' }
      if (branchOperation.phase === 'running' || branchOperation.phase === 'queued') {
        // A queued pull/push can be replaced by the latest network branch action; running work cannot.
        if (!network || branchOperation.phase !== 'queued') return { ok: false, message: 'cancelled' }
      }
      const schedule = evaluateRepoBranchActionSchedule(repoBefore, action)
      if (schedule.blockedMessage) {
        const result = { ok: false, message: schedule.blockedMessage }
        get().setLastResult(id, result, workspaceRuntimeId)
        return result
      }
      const handleResult = async (result: ExecResult) => {
        if (!shouldSuppressBranchActionResultMessage(result, options)) {
          get().setLastResult(id, result, workspaceRuntimeId, { action: branchActionEventAction(action) })
        }
      }
      const handleError = (message: string) => {
        if (message === 'cancelled') return
        get().setLastResult(id, { ok: false, message }, workspaceRuntimeId, { action: branchActionEventAction(action) })
      }
      const handleStale = () => {}
      const runActionTask = async (signal: AbortSignal, ctx: { setPhase: (phase: 'queued' | 'running') => void }) => {
        throwIfStale(get, id, workspaceRuntimeId)
        ctx.setPhase('running')
        return runBranchActionIpc(action, id, workspaceRuntimeId, signal)
      }

      if (network) {
        return await runLatestOperation({
          set,
          get,
          id,
          workspaceRuntimeId,
          lane: 'network',
          operationKey: BRANCH_NETWORK_OPERATION_KEY,
          priority: 100,
          targets: [branchActionTarget(action), { key: 'fetch', reason: networkFetchReason(action) }],
          task: runActionTask,
          queuedTimeoutMs: options?.waitTimeoutMs ?? BRANCH_ACTION_WAIT_TIMEOUT_MS,
          queuedTimeoutMessage: BRANCH_ACTION_WAIT_TIMEOUT_MESSAGE,
          errorFromResult: branchActionErrorFromResult,
          errorResult: branchActionErrorResult,
          onResult: handleResult,
          onError: handleError,
          onStale: handleStale,
        })
      }

      return await runExclusiveOperation({
        set,
        get,
        id,
        workspaceRuntimeId,
        lane: 'write',
        priority: 100,
        targets: [branchActionTarget(action)],
        busyResult: branchActionErrorResult('cancelled'),
        task: runActionTask,
        errorFromResult: branchActionErrorFromResult,
        errorResult: branchActionErrorResult,
        onResult: handleResult,
        onError: handleError,
      })
    },
  }
}
