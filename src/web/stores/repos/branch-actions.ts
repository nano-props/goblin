import {
  runExclusiveOperation,
  runLatestOperation,
  type RepoOperationContext,
  type RepoOperationTarget,
} from '#/web/stores/repos/operation-runner.ts'
import { RepoOperationCancelledError } from '#/web/stores/repos/operation-cancellation.ts'
import type { RepoBranchActionReason, RepoOperationReason } from '#/web/stores/repos/operations.ts'
import { isRepoUnavailable, updateIfFresh } from '#/web/stores/repos/repo-guards.ts'
import {
  repoOperation,
  repoLocalBranchActionScheduleGuard,
  repoLocalProjectionReadBusy,
  waitForRepoOperationsIdle,
} from '#/web/stores/repos/repo-operation-scheduler.ts'
import {
  cancelDataLoad,
  finishDataLoadError,
  finishDataLoadSuccess,
  startDataLoad,
} from '#/web/stores/repos/repo-data-load-state.ts'
import type {
  RepoBranchAction,
  RepoBranchActionKind,
  RunBranchActionOptions,
} from '#/web/stores/repos/branch-action-types.ts'
import {
  evaluateBranchActionSchedule as evaluateBranchActionScheduleDecision,
  isNetworkBranchActionKind,
} from '#/web/stores/repos/branch-action-scheduler.ts'
import type { RepoEventAction, RepoState, ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
import type { ExecResult } from '#/web/types.ts'
import { requestRepoProjectionReadModelRefresh } from '#/web/stores/repos/refresh.ts'
import {
  createRepoWorktree,
  deleteRepoBranch,
  pullRepoBranch,
  pushRepoBranch,
  removeRepoWorktree,
} from '#/web/repo-client.ts'
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'
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
        alsoDeleteBranch: action.alsoDeleteBranch,
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

function evaluateRepoBranchActionSchedule(repo: RepoState, action: RepoBranchAction) {
  const guard = repoLocalBranchActionScheduleGuard(repo.id)
  return evaluateBranchActionScheduleDecision({
    actionKind: action.kind,
    fetchBusy: guard.fetchBusy,
    branchOperationPhase: guard.branchOperationPhase,
    projectionReadBusy: guard.projectionReadBusy,
  })
}

function throwIfStale(get: ReposGet, id: string, repoRuntimeId: string): void {
  if (get().repos[id]?.repoRuntimeId !== repoRuntimeId) throw new RepoOperationCancelledError()
}

function settleNetworkFetchDataLoadState(
  set: ReposSet,
  id: string,
  repoRuntimeId: string,
  ownsFetchDataLoad: boolean,
  result: ExecResult | { ok: false; message: string },
): void {
  if (!ownsFetchDataLoad) return
  updateIfFresh(set, id, repoRuntimeId, (r) => {
    if (result.message === 'cancelled') {
      cancelDataLoad(r.dataLoads.fetch)
      return
    }
    if (result.ok) finishDataLoadSuccess(r.dataLoads.fetch)
    else finishDataLoadError(r.dataLoads.fetch, result.message)
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
  if (!result.ok && result.repoChanged) return false
  if (shouldSuppressBranchActionResultMessage(result, options)) return true
  if (!result.ok && result.message === 'error.network-op-in-progress') return true
  if (!result.ok && result.message === BRANCH_ACTION_WAIT_TIMEOUT_MESSAGE) return true
  return false
}

function shouldRefreshBranchActionProjection(result: ExecResult, options?: RunBranchActionOptions): boolean {
  if (shouldSkipBranchActionRefresh(result, options)) return false
  return result.ok || result.repoChanged || options?.refreshOnError !== false
}

function requiresProjectionRefreshBeforeCompletion(action: RepoBranchAction, result: ExecResult): boolean {
  return result.ok && (action.kind === 'createWorktree' || action.kind === 'removeWorktree')
}

function waitForBranchActionIdle(
  id: string,
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
  repoRuntimeId: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  switch (action.kind) {
    case 'pull':
      return pullRepoBranch(repoId, repoRuntimeId, action.branch, action.worktreePath, signal)
    case 'push':
      return pushRepoBranch(repoId, repoRuntimeId, action.branch, signal)
    case 'createWorktree':
      return createRepoWorktree(repoId, repoRuntimeId, action.input, action.worktreeBootstrap, signal)
    case 'deleteBranch':
      return deleteRepoBranch(
        repoId,
        repoRuntimeId,
        action.branch,
        { force: action.force, alsoDeleteUpstream: action.alsoDeleteUpstream },
        signal,
      )
    case 'removeWorktree':
      return removeRepoWorktree(
        repoId,
        repoRuntimeId,
        {
          branch: action.branch,
          worktreePath: action.worktreePath,
          alsoDeleteBranch: action.alsoDeleteBranch,
          forceDeleteBranch: action.forceDeleteBranch,
          alsoDeleteUpstream: action.alsoDeleteUpstream,
        },
        signal,
      )
  }
  const exhaustive: never = action
  return exhaustive
}

export function createBranchActions(set: ReposSet, get: ReposGet) {
  return {
    submitBranchAction(id: string, action: RepoBranchAction, options?: RunBranchActionOptions): void {
      const repo = get().repos[id]
      const repoRuntimeId = options?.repoRuntimeId ?? repo?.repoRuntimeId
      if (!repo || repo.repoRuntimeId !== repoRuntimeId) return
      void get().runBranchAction(id, action, options)
    },

    async runBranchAction(
      id: string,
      action: RepoBranchAction,
      options?: RunBranchActionOptions,
    ): Promise<ExecResult | null> {
      const repoBefore = get().repos[id]
      if (!repoBefore) return null
      const repoRuntimeId = options?.repoRuntimeId ?? repoBefore.repoRuntimeId
      if (repoBefore.repoRuntimeId !== repoRuntimeId) return null
      const network = isNetworkBranchAction(action)
      const branchOperation = repoOperation(id, 'branchAction')
      if (isRepoUnavailable(repoBefore)) {
        // Per the lifecycle union: local repos carry their
        // failure reason in `availability.reason`; remote repos
        // carry it in `remote.lifecycle.reason` (or 'unknown'
        // before Phase 3 had a chance to settle it). Either way,
        // we won't run branch actions on a failed repo.
        const reason =
          repoBefore.remote.lifecycle?.kind === 'failed'
            ? repoBefore.remote.lifecycle.reason
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
        get().setLastResult(id, result, repoRuntimeId)
        return result
      }
      updateIfFresh(set, id, repoRuntimeId, (r) => {
        if (network) startDataLoad(r.dataLoads.fetch, { hasData: r.dataLoads.fetch.loadedAt !== null })
      })
      const ownsNetworkFetchDataLoad = (ctx: Pick<RepoOperationContext, 'ownsTarget'>) =>
        network && ctx.ownsTarget('fetch')
      const refreshAfterBranchAction = async (result: ExecResult): Promise<void> => {
        if (!shouldRefreshBranchActionProjection(result, options)) return
        const repo = get().repos[id]
        if (repo?.repoRuntimeId !== repoRuntimeId) return
        await requestRepoProjectionReadModelRefresh({ get, set }, id, { repoRuntimeId })
      }
      const handleResult = async (result: ExecResult, ctx: RepoOperationContext) => {
        const ownsFetchDataLoad = ownsNetworkFetchDataLoad(ctx)
        settleNetworkFetchDataLoadState(set, id, repoRuntimeId, ownsFetchDataLoad, result)
        if (!shouldSuppressBranchActionResultMessage(result, options)) {
          get().setLastResult(id, result, repoRuntimeId, { action: branchActionEventAction(action) })
        }
        if (!requiresProjectionRefreshBeforeCompletion(action, result)) await refreshAfterBranchAction(result)
        if (result.ok && ownsFetchDataLoad) get().clearFetchFailed(id, repoRuntimeId)
      }
      const handleError = (message: string, ctx: RepoOperationContext) => {
        settleNetworkFetchDataLoadState(set, id, repoRuntimeId, ownsNetworkFetchDataLoad(ctx), { ok: false, message })
        if (message === 'cancelled') return
        get().setLastResult(id, { ok: false, message }, repoRuntimeId, { action: branchActionEventAction(action) })
      }
      const handleStale = (ctx: RepoOperationContext) => {
        settleNetworkFetchDataLoadState(set, id, repoRuntimeId, ownsNetworkFetchDataLoad(ctx), {
          ok: false,
          message: 'cancelled',
        })
      }
      const runActionTask = async (signal: AbortSignal, ctx: { setPhase: (phase: 'queued' | 'running') => void }) => {
        try {
          if (repoLocalProjectionReadBusy(id)) {
            ctx.setPhase('queued')
            signal.throwIfAborted()
            await waitForBranchActionIdle(id, ['repoReadModel', 'visibleStatus'], signal, options?.waitTimeoutMs)
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (message === BRANCH_ACTION_WAIT_TIMEOUT_MESSAGE) return branchActionErrorResult(message)
          throw err
        }
        throwIfStale(get, id, repoRuntimeId)
        ctx.setPhase('running')
        return runBranchActionIpc(action, id, repoRuntimeId, signal)
      }

      const completionBarrier = async (result: ExecResult) => {
        if (requiresProjectionRefreshBeforeCompletion(action, result)) await refreshAfterBranchAction(result)
      }

      if (network) {
        return await runLatestOperation({
          set,
          get,
          id,
          repoRuntimeId,
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
        repoRuntimeId,
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
