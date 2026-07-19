import {
  runExclusiveOperation,
  runLatestOperation,
  type RepoOperationContext,
  type RepoOperationTarget,
} from '#/web/stores/workspaces/operation-runner.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { RepoOperationCancelledError } from '#/web/stores/workspaces/operation-cancellation.ts'
import type { RepoBranchActionReason, RepoOperationReason } from '#/web/stores/workspaces/operations.ts'
import { isWorkspaceUnavailable, updateIfFresh } from '#/web/stores/workspaces/workspace-guards.ts'
import {
  repoOperation,
  repoLocalBranchActionScheduleGuard,
  repoLocalProjectionReadBusy,
  waitForRepoOperationsIdle,
} from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import {
  cancelDataLoad,
  finishDataLoadError,
  finishDataLoadSuccess,
  startDataLoad,
} from '#/web/stores/workspaces/repo-data-load-state.ts'
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
import { requestRepoProjectionReadModelRefresh } from '#/web/stores/workspaces/refresh.ts'
import {
  createRepoWorktree,
  deleteRepoBranch,
  pullRepoBranch,
  pushRepoBranch,
  removeRepoWorktree,
} from '#/web/repo-client.ts'
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'
import { gitWorkspaceProjection, isGitWorkspace } from '#/web/stores/workspaces/git-workspace-projection.ts'
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
    projectionReadBusy: guard.projectionReadBusy,
  })
}

function throwIfStale(get: WorkspacesGet, id: WorkspaceId, workspaceRuntimeId: string): void {
  if (get().workspaces[id]?.workspaceRuntimeId !== workspaceRuntimeId) throw new RepoOperationCancelledError()
}

function settleNetworkFetchDataLoadState(
  set: WorkspacesSet,
  id: WorkspaceId,
  workspaceRuntimeId: string,
  ownsFetchDataLoad: boolean,
  result: ExecResult | { ok: false; message: string },
): void {
  if (!ownsFetchDataLoad) return
  updateIfFresh(set, id, workspaceRuntimeId, (r) => {
    if (!isGitWorkspace(r)) return
    const fetch = gitWorkspaceProjection(r).dataLoads.fetch
    if (result.message === 'cancelled') {
      cancelDataLoad(fetch)
      return
    }
    if (result.ok) finishDataLoadSuccess(fetch)
    else finishDataLoadError(fetch, result.message)
  })
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

function shouldSkipBranchActionRefresh(result: ExecResult, options?: RunBranchActionOptions): boolean {
  if (!result.ok && result.repositoryStateChanged) return false
  if (shouldSuppressBranchActionResultMessage(result, options)) return true
  if (!result.ok && result.message === 'error.network-op-in-progress') return true
  if (!result.ok && result.message === BRANCH_ACTION_WAIT_TIMEOUT_MESSAGE) return true
  return false
}

function shouldRefreshBranchActionProjection(result: ExecResult, options?: RunBranchActionOptions): boolean {
  if (shouldSkipBranchActionRefresh(result, options)) return false
  return result.ok || result.repositoryStateChanged || options?.refreshOnError !== false
}

function requiresProjectionRefreshBeforeCompletion(action: RepoBranchAction, result: ExecResult): boolean {
  return result.ok && (action.kind === 'createWorktree' || action.kind === 'removeWorktree')
}

function waitForBranchActionIdle(
  id: WorkspaceId,
  keys: Parameters<typeof waitForRepoOperationsIdle>[1],
  signal: AbortSignal,
  timeoutMs = BRANCH_ACTION_WAIT_TIMEOUT_MS,
) {
  const ctrl = new AbortController()
  const timeout = globalThis.setTimeout(() => ctrl.abort(BRANCH_ACTION_WAIT_TIMEOUT_MESSAGE), timeoutMs)
  const abort = () => ctrl.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) ctrl.abort()
  return waitForRepoOperationsIdle(id, keys, ctrl.signal)
    .catch((err) => {
      if (ctrl.signal.reason === BRANCH_ACTION_WAIT_TIMEOUT_MESSAGE) throw new Error(BRANCH_ACTION_WAIT_TIMEOUT_MESSAGE)
      throw err
    })
    .finally(() => {
      globalThis.clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    })
}

function runBranchActionIpc(
  action: RepoBranchAction,
  repoId: string,
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
      if (isWorkspaceUnavailable(repoBefore)) {
        // Per the lifecycle union: local repos carry their
        // failure reason in `availability.reason`; remote repos
        // carry it in `admission.lifecycle.reason` (or 'unknown'
        // before Phase 3 had a chance to settle it). Either way,
        // we won't run branch actions on a failed repo.
        const reason =
          repoBefore.admission.kind === 'remote' && repoBefore.admission.lifecycle?.kind === 'failed'
            ? repoBefore.admission.lifecycle.reason
            : repoBefore.availability.phase === 'unavailable'
              ? repoBefore.availability.reason
              : 'error.failed-read-repo'
        return { ok: false, message: reason }
      }
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
      updateIfFresh(set, id, workspaceRuntimeId, (r) => {
        if (!isGitWorkspace(r)) return
        const fetch = gitWorkspaceProjection(r).dataLoads.fetch
        if (network) startDataLoad(fetch, { hasData: fetch.loadedAt !== null })
      })
      const ownsNetworkFetchDataLoad = (ctx: Pick<RepoOperationContext, 'ownsTarget'>) =>
        network && ctx.ownsTarget('fetch')
      const refreshAfterBranchAction = async (result: ExecResult): Promise<void> => {
        if (!shouldRefreshBranchActionProjection(result, options)) return
        const repo = get().workspaces[id]
        if (repo?.workspaceRuntimeId !== workspaceRuntimeId) return
        await requestRepoProjectionReadModelRefresh({ get, set }, id, { workspaceRuntimeId })
      }
      const handleResult = async (result: ExecResult, ctx: RepoOperationContext) => {
        const ownsFetchDataLoad = ownsNetworkFetchDataLoad(ctx)
        settleNetworkFetchDataLoadState(set, id, workspaceRuntimeId, ownsFetchDataLoad, result)
        if (!shouldSuppressBranchActionResultMessage(result, options)) {
          get().setLastResult(id, result, workspaceRuntimeId, { action: branchActionEventAction(action) })
        }
        if (!requiresProjectionRefreshBeforeCompletion(action, result)) await refreshAfterBranchAction(result)
        if (result.ok && ownsFetchDataLoad) get().clearFetchFailed(id, workspaceRuntimeId)
      }
      const handleError = (message: string, ctx: RepoOperationContext) => {
        settleNetworkFetchDataLoadState(set, id, workspaceRuntimeId, ownsNetworkFetchDataLoad(ctx), {
          ok: false,
          message,
        })
        if (message === 'cancelled') return
        get().setLastResult(id, { ok: false, message }, workspaceRuntimeId, { action: branchActionEventAction(action) })
      }
      const handleStale = (ctx: RepoOperationContext) => {
        settleNetworkFetchDataLoadState(set, id, workspaceRuntimeId, ownsNetworkFetchDataLoad(ctx), {
          ok: false,
          message: 'cancelled',
        })
      }
      const runActionTask = async (signal: AbortSignal, ctx: { setPhase: (phase: 'queued' | 'running') => void }) => {
        try {
          if (repoLocalProjectionReadBusy(id)) {
            ctx.setPhase('queued')
            signal.throwIfAborted()
            await waitForBranchActionIdle(id, ['repoReadModel'], signal, options?.waitTimeoutMs)
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (message === BRANCH_ACTION_WAIT_TIMEOUT_MESSAGE) return branchActionErrorResult(message)
          throw err
        }
        throwIfStale(get, id, workspaceRuntimeId)
        ctx.setPhase('running')
        return runBranchActionIpc(action, id, workspaceRuntimeId, signal)
      }

      const completionBarrier = async (result: ExecResult) => {
        if (requiresProjectionRefreshBeforeCompletion(action, result)) await refreshAfterBranchAction(result)
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
          completionBarrier,
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
        completionBarrier,
        errorFromResult: branchActionErrorFromResult,
        errorResult: branchActionErrorResult,
        onResult: handleResult,
        onError: handleError,
      })
    },
  }
}
