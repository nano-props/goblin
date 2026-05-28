import {
  runExclusiveOperation,
  runLatestOperation,
  type RepoOperationTarget,
} from '#/renderer/stores/repos/operation-runner.ts'
import type { RepoBranchActionReason, RepoOperationReason } from '#/renderer/stores/repos/operations.ts'
import { updateIfFresh } from '#/renderer/stores/repos/helpers.ts'
import { repoOperation, repoOperationBusy, waitForRepoOperationsIdle } from '#/renderer/stores/repos/runtime.ts'
import {
  cancelResource,
  finishResourceError,
  finishResourceSuccess,
  resourceBusy,
  startResource,
} from '#/renderer/stores/repos/resources.ts'
import type {
  RepoBranchAction,
  RepoBranchActionKind,
  RunBranchActionOptions,
} from '#/renderer/stores/repos/branch-action-types.ts'
import {
  evaluateBranchActionSchedule as evaluateBranchActionScheduleDecision,
  isNetworkBranchActionKind,
} from '#/renderer/stores/repos/branch-action-scheduler.ts'
import type { RepoEventAction, RepoState, ReposGet, ReposSet } from '#/renderer/stores/repos/types.ts'
import type { ExecResult } from '#/renderer/types.ts'
import { runBranchActionRefreshWorkflow } from '#/renderer/stores/repos/refresh-workflows.ts'
import { rpc } from '#/renderer/rpc.ts'

const BRANCH_NETWORK_OPERATION_KEY = 'branch-network-action'
const BRANCH_ACTION_WAIT_TIMEOUT_MS = 30_000
const BRANCH_ACTION_WAIT_TIMEOUT_MESSAGE = 'error.branch-action-wait-timeout'
const BRANCH_ACTION_REASON_BY_KIND: Record<RepoBranchActionKind, RepoBranchActionReason> = {
  checkout: 'branch:checkout',
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

export function repoBranchActionReason(kind: RepoBranchActionKind): RepoBranchActionReason {
  return BRANCH_ACTION_REASON_BY_KIND[kind]
}

function branchActionReason(action: RepoBranchAction): RepoBranchActionReason {
  return repoBranchActionReason(action.kind)
}

function branchActionOperationTarget(action: RepoBranchAction): string | null {
  switch (action.kind) {
    case 'checkout':
    case 'pull':
    case 'push':
    case 'deleteBranch':
    case 'removeWorktree':
      return action.branch
    case 'createWorktree':
      return action.newBranch
  }
  const exhaustive: never = action
  return exhaustive
}

function branchActionEventAction(action: RepoBranchAction): RepoEventAction {
  switch (action.kind) {
    case 'checkout':
    case 'pull':
    case 'push':
    case 'deleteBranch':
      return { kind: action.kind, branch: action.branch }
    case 'createWorktree':
      return { kind: action.kind, branch: action.newBranch, worktreePath: action.worktreePath }
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

function abortBackgroundFetchIfActive(id: string): void {
  const operation = repoOperation(id, 'fetch')
  if (operation.phase === 'running' && operation.reason === 'background-fetch') {
    void rpc.repo.abort.mutate({ cwd: id }).catch(() => {})
  }
}

function coreRefreshBusy(id: string): boolean {
  return repoOperationBusy(id, 'snapshot') || repoOperationBusy(id, 'status')
}

function evaluateRepoBranchActionSchedule(repo: RepoState, action: RepoBranchAction) {
  const fetchOperation = repoOperation(repo.id, 'fetch')
  const branchOperation = repoOperation(repo.id, 'branchAction')
  return evaluateBranchActionScheduleDecision({
    actionKind: action.kind,
    fetchBusy: resourceBusy(repo.resources.fetch) || fetchOperation.phase !== 'idle',
    fetchOperationPhase: fetchOperation.phase,
    fetchOperationReason: fetchOperation.reason,
    branchOperationPhase: branchOperation.phase,
    coreRefreshBusy: coreRefreshBusy(repo.id),
  })
}

function throwIfStale(get: ReposGet, id: string, token: number): void {
  if (get().repos[id]?.instanceToken !== token) throw new Error('cancelled')
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

function runBranchActionRpc(action: RepoBranchAction, repoId: string, signal?: AbortSignal): Promise<ExecResult> {
  switch (action.kind) {
    case 'checkout':
      return rpc.repo.checkout.mutate({ cwd: repoId, branch: action.branch }, { signal })
    case 'pull':
      return rpc.repo.pull.mutate({ cwd: repoId, branch: action.branch, worktreePath: action.worktreePath }, { signal })
    case 'push':
      return rpc.repo.push.mutate({ cwd: repoId, branch: action.branch }, { signal })
    case 'createWorktree':
      return rpc.repo.createWorktree.mutate(
        {
          cwd: repoId,
          worktreePath: action.worktreePath,
          newBranch: action.newBranch,
          baseBranch: action.baseBranch,
        },
        { signal },
      )
    case 'deleteBranch':
      return rpc.repo.deleteBranch.mutate(
        { cwd: repoId, branch: action.branch, force: action.force, alsoDeleteUpstream: action.alsoDeleteUpstream },
        { signal },
      )
    case 'removeWorktree':
      return rpc.repo.removeWorktree.mutate(
        {
          cwd: repoId,
          branch: action.branch,
          worktreePath: action.worktreePath,
          alsoDeleteBranch: action.alsoDeleteBranch,
          forceDeleteBranch: action.forceDeleteBranch,
          alsoDeleteUpstream: action.alsoDeleteUpstream,
        },
        { signal },
      )
  }
  const exhaustive: never = action
  return exhaustive
}

export function createBranchActions(set: ReposSet, get: ReposGet) {
  return {
    async runBranchAction(
      id: string,
      action: RepoBranchAction,
      options?: RunBranchActionOptions,
    ): Promise<ExecResult | null> {
      const repoBefore = get().repos[id]
      if (!repoBefore) return null
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return null
      const network = isNetworkBranchAction(action)
      const branchOperation = repoOperation(id, 'branchAction')
      if (repoBefore.availability.phase === 'unavailable') {
        return { ok: false, message: repoBefore.availability.reason }
      }
      if (
        branchOperation.phase === 'running' ||
        branchOperation.phase === 'queued'
      ) {
        // A queued pull/push can be replaced by the latest network branch action; running work cannot.
        if (!network || branchOperation.phase !== 'queued') return { ok: false, message: 'cancelled' }
      }
      const schedule = evaluateRepoBranchActionSchedule(repoBefore, action)
      if (schedule.blockedMessage) {
        const result = { ok: false, message: schedule.blockedMessage }
        get().setLastResult(id, result, token)
        return result
      }
      if (schedule.shouldAbortBackgroundFetch) abortBackgroundFetchIfActive(id)
      updateIfFresh(set, id, token, (r) => {
        if (network) startResource(r.resources.fetch, { hasData: r.resources.fetch.loadedAt !== null })
      })
      const handleResult = async (result: ExecResult) => {
        updateIfFresh(set, id, token, (r) => {
          if (result.message === 'cancelled') {
            if (network) cancelResource(r.resources.fetch)
          } else if (result.ok) {
            if (network) finishResourceSuccess(r.resources.fetch)
          } else {
            if (network) finishResourceError(r.resources.fetch, result.message)
          }
        })
        if (result.message === 'cancelled') return
        if (options?.deferResultMessages?.includes(result.message)) return
        get().setLastResult(id, result, token, { action: branchActionEventAction(action) })
        if (!result.ok && result.message === 'error.network-op-in-progress') return
        if (!result.ok && result.message === BRANCH_ACTION_WAIT_TIMEOUT_MESSAGE) return
        if (result.ok || options?.refreshOnError !== false) {
          const repo = get().repos[id]
          if (repo?.instanceToken === token) await runBranchActionRefreshWorkflow(get, { id, token })
        }
        if (result.ok && network) get().clearFetchFailed(id, token)
      }
      const handleError = (message: string) => {
        if (message === 'cancelled') {
          updateIfFresh(set, id, token, (r) => {
            if (network) cancelResource(r.resources.fetch)
          })
          return
        }
        updateIfFresh(set, id, token, (r) => {
          if (network) finishResourceError(r.resources.fetch, message)
        })
        get().setLastResult(id, { ok: false, message }, token, { action: branchActionEventAction(action) })
      }
      const errorFromResult = (result: ExecResult) =>
        !result.ok && result.message !== 'cancelled' ? result.message : null
      const errorResult = (message: string): ExecResult => ({ ok: false, message })
      const runActionTask = async (signal: AbortSignal, ctx: { setPhase: (phase: 'queued' | 'running') => void }) => {
        try {
          if (schedule.waitForBackgroundFetch) {
            ctx.setPhase('queued')
            signal.throwIfAborted()
            await waitForBranchActionIdle(id, ['fetch'], signal, options?.waitTimeoutMs)
          }
          if (coreRefreshBusy(id)) {
            ctx.setPhase('queued')
            signal.throwIfAborted()
            await waitForBranchActionIdle(id, ['snapshot', 'status'], signal, options?.waitTimeoutMs)
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (message === BRANCH_ACTION_WAIT_TIMEOUT_MESSAGE) return { ok: false, message }
          throw err
        }
        throwIfStale(get, id, token)
        ctx.setPhase('running')
        return runBranchActionRpc(action, id, signal)
      }

      if (network) {
        return runLatestOperation({
          set,
          get,
          id,
          token,
          lane: 'network',
          operationKey: BRANCH_NETWORK_OPERATION_KEY,
          priority: 100,
          targets: [branchActionTarget(action), { key: 'fetch', reason: networkFetchReason(action) }],
          task: runActionTask,
          queuedTimeoutMs: options?.waitTimeoutMs ?? BRANCH_ACTION_WAIT_TIMEOUT_MS,
          queuedTimeoutMessage: BRANCH_ACTION_WAIT_TIMEOUT_MESSAGE,
          errorFromResult,
          errorResult,
          onResult: handleResult,
          onError: handleError,
        })
      }

      return runExclusiveOperation({
        set,
        get,
        id,
        token,
        lane: 'write',
        priority: 100,
        targets: [branchActionTarget(action)],
        busyResult: { ok: false, message: 'cancelled' },
        task: runActionTask,
        errorFromResult,
        errorResult,
        onResult: handleResult,
        onError: handleError,
      })
    },
  }
}
