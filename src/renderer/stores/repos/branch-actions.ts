import {
  runExclusiveOperation,
  runLatestOperation,
  type RepoOperationTarget,
} from '#/renderer/stores/repos/operation-runner.ts'
import type { RepoBranchActionReason, RepoOperationReason } from '#/renderer/stores/repos/operations.ts'
import { updateIfFresh } from '#/renderer/stores/repos/helpers.ts'
import {
  cancelQueuedRepoTask,
  repoOperation,
  repoOperationBusy,
  waitForRepoOperationsIdle,
} from '#/renderer/stores/repos/runtime.ts'
import {
  cancelResource,
  finishBranchActionResourceError,
  finishBranchActionResourceSuccess,
  finishResourceError,
  finishResourceSuccess,
  resourceBusy,
  setBranchActionResourcePhase,
  startBranchActionResource,
  startResource,
} from '#/renderer/stores/repos/resources.ts'
import { canStartRemoteFetch } from '#/renderer/stores/repos/sync-state.ts'
import type {
  RepoBranchAction,
  RepoBranchActionKind,
  RunBranchActionOptions,
} from '#/renderer/stores/repos/branch-action-types.ts'
import type { RepoEventAction, RepoState, ReposGet, ReposSet } from '#/renderer/stores/repos/types.ts'
import type { ExecResult } from '#/renderer/types.ts'
import { runBranchActionRefreshWorkflow } from '#/renderer/stores/repos/refresh-workflows.ts'
import { rpc } from '#/renderer/rpc.ts'

const NETWORK_BRANCH_ACTIONS = new Set<RepoBranchActionKind>(['pull', 'push'])
const BRANCH_NETWORK_OPERATION_KEY = 'branch-network-action'
const branchNetworkReplaceKey = () => `network:${BRANCH_NETWORK_OPERATION_KEY}`
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
  return NETWORK_BRANCH_ACTIONS.has(action.kind)
}

function branchActionTarget(action: RepoBranchAction): RepoOperationTarget {
  return {
    key: 'branchAction',
    reason: branchActionReason(action),
    target: branchActionOperationTarget(action),
  }
}

function canStartBranchNetwork(repo: RepoState): boolean {
  return canStartRemoteFetch(repo)
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

async function waitForCoreRefresh(id: string, signal: AbortSignal): Promise<void> {
  await waitForRepoOperationsIdle(id, ['snapshot', 'status'], signal)
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
    cancelBranchAction(id: string, options?: { token?: number }): boolean {
      const repoBefore = get().repos[id]
      if (!repoBefore) return false
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return false
      const operation = repoOperation(id, 'branchAction')
      const action = repoBefore.resources.branchAction
      if (
        !resourceBusy(action) ||
        (action.kind !== 'pull' && action.kind !== 'push') ||
        (operation.reason !== 'branch:pull' && operation.reason !== 'branch:push')
      ) {
        return false
      }
      if (operation.phase === 'running') {
        void rpc.repo.abort.mutate({ cwd: id }).catch(() => {})
        return true
      }
      if (operation.phase !== 'queued') return false
      const cancelled = cancelQueuedRepoTask(id, 'network', branchNetworkReplaceKey())
      if (!cancelled) return false
      updateIfFresh(set, id, token, (r) => {
        finishBranchActionResourceSuccess(r.resources.branchAction)
        cancelResource(r.resources.fetch)
      })
      return true
    },

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
        resourceBusy(repoBefore.resources.branchAction) ||
        branchOperation.phase === 'running' ||
        branchOperation.phase === 'queued'
      ) {
        // A queued pull/push can be replaced by the latest network branch action; running work cannot.
        if (!network || branchOperation.phase !== 'queued') return { ok: false, message: 'cancelled' }
      }
      if (!network && !canStartBranchNetwork(repoBefore)) {
        const result = { ok: false, message: 'error.network-op-in-progress' }
        get().setLastResult(id, result, token)
        return result
      }
      const networkBlocked = network && !canStartBranchNetwork(repoBefore)
      if (networkBlocked) abortBackgroundFetchIfActive(id)
      updateIfFresh(set, id, token, (r) => {
        startBranchActionResource(r.resources.branchAction, action.kind, branchActionOperationTarget(action), {
          actionPhase: networkBlocked ? 'queued' : 'running',
        })
        if (network) startResource(r.resources.fetch, { hasData: r.resources.fetch.loadedAt !== null })
      })
      const handleResult = async (result: ExecResult) => {
        updateIfFresh(set, id, token, (r) => {
          if (result.message === 'cancelled') {
            finishBranchActionResourceSuccess(r.resources.branchAction)
            if (network) cancelResource(r.resources.fetch)
          } else if (result.ok) {
            finishBranchActionResourceSuccess(r.resources.branchAction)
            if (network) finishResourceSuccess(r.resources.fetch)
          } else {
            finishBranchActionResourceError(r.resources.branchAction, result.message)
            if (network) finishResourceError(r.resources.fetch, result.message)
          }
        })
        if (result.message === 'cancelled') return
        if (options?.deferResultMessages?.includes(result.message)) return
        get().setLastResult(id, result, token, { action: branchActionEventAction(action) })
        if (!result.ok && result.message === 'error.network-op-in-progress') return
        if (result.ok || options?.refreshOnError !== false) {
          const repo = get().repos[id]
          if (repo?.instanceToken === token) await runBranchActionRefreshWorkflow(get, { id, token })
        }
        if (result.ok && network) get().clearFetchFailed(id, token)
      }
      const handleError = (message: string) => {
        updateIfFresh(set, id, token, (r) => {
          finishBranchActionResourceError(r.resources.branchAction, message)
          if (network) finishResourceError(r.resources.fetch, message)
        })
        get().setLastResult(id, { ok: false, message }, token, { action: branchActionEventAction(action) })
      }
      const errorFromResult = (result: ExecResult) =>
        !result.ok && result.message !== 'cancelled' ? result.message : null

      if (network) {
        return runLatestOperation({
          get,
          id,
          token,
          lane: 'network',
          operationKey: BRANCH_NETWORK_OPERATION_KEY,
          priority: 100,
          targets: [branchActionTarget(action), { key: 'fetch', reason: networkFetchReason(action) }],
          task: async (signal: AbortSignal) => {
            if (coreRefreshBusy(id)) {
              updateIfFresh(set, id, token, (r) => setBranchActionResourcePhase(r.resources.branchAction, 'queued'))
              await waitForCoreRefresh(id, signal)
            }
            updateIfFresh(set, id, token, (r) => setBranchActionResourcePhase(r.resources.branchAction, 'running'))
            return runBranchActionRpc(action, id, signal)
          },
          errorFromResult,
          onResult: handleResult,
          onError: (message) => {
            if (message === 'cancelled') {
              updateIfFresh(set, id, token, (r) => {
                finishBranchActionResourceSuccess(r.resources.branchAction)
                cancelResource(r.resources.fetch)
              })
              return
            }
            handleError(message)
          },
        })
      }

      return runExclusiveOperation({
        get,
        id,
        token,
        lane: 'write',
        priority: 100,
        targets: [branchActionTarget(action)],
        busyResult: { ok: false, message: 'cancelled' },
        task: (signal: AbortSignal) => runBranchActionRpc(action, id, signal),
        errorFromResult,
        onResult: handleResult,
        onError: handleError,
      })
    },
  }
}
